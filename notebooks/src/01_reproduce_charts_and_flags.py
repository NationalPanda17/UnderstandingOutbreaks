# %% [markdown]
# # Reproduce the site's main chart and signal flags
#
# This notebook loads Understanding Outbreaks data, redraws a country chart, recomputes the automated signal
# flags with the documented method, and shows how to load a specific snapshot.
#
# The data aggregates official public reports. It is not a surveillance system and not medical advice.
# Every row carries its source: keep the `source_id`, `source_url` and `snapshot_id` columns when you share results.

# %%
import json, os
import numpy as np
import pandas as pd

BASE = os.environ.get("UO_BASE", "https://understandingoutbreaks.pages.dev/data/v1")  # or a local folder
DISEASE, ISO3 = "measles", "KEN"

def read_json(path):
    if BASE.startswith("http"):
        import urllib.request
        with urllib.request.urlopen(f"{BASE}/{path}") as r:
            return json.load(r)
    with open(os.path.join(BASE, path), encoding="utf-8") as f:
        return json.load(f)

manifest = read_json("manifest.json")
print("latest snapshot:", manifest["snapshot_id"], "| snapshots so far:", len(manifest["snapshots"]))

# %% [markdown]
# ## 1. The main chart: default series, with likely-incomplete periods marked

# %%
ts = pd.read_parquet(f"{BASE}/bulk/timeseries/disease={DISEASE}/data.parquet")
country = ts[(ts["iso3"] == ISO3) & ts["is_default_series"]].sort_values("period_start")
print(country[["period_start", "value", "rate_per_100k", "likely_incomplete", "case_definition", "source_id"]].tail(6).to_string(index=False))
print("source:", country["source_id"].iloc[0], "|", country["source_url"].iloc[0])
print("license:", country["license"].iloc[0])

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(9, 3.5))
    done = country[~country["likely_incomplete"]]
    ax.plot(pd.to_datetime(done["period_start"]), done["value"], color="#0072B2")
    inc = country[country["likely_incomplete"]]
    if len(inc):
        ax.axvspan(pd.to_datetime(inc["period_start"]).min(), pd.to_datetime(country["period_start"]).max(), color="#dddddd", hatch="//", alpha=0.6, label="likely incomplete")
        ax.plot(pd.to_datetime(inc["period_start"]), inc["value"], color="#0072B2", linestyle=":")
    ax.set_title(f"{DISEASE} in {ISO3}: reported {country['metric'].iloc[0]} ({country['case_definition'].iloc[0]})")
    ax.set_xlabel(f"Source: {country['source_id'].iloc[0]} via Understanding Outbreaks, snapshot {manifest['snapshot_id']}")
    ax.legend(loc="upper left")
    fig.tight_layout()
    os.makedirs("out", exist_ok=True)
    fig.savefig("out/main_chart.png", dpi=120)
    print("saved out/main_chart.png")
except ImportError:
    print("matplotlib not installed: skipping the plot")

# %% [markdown]
# ## 2. Recompute the signal flags
#
# Method `rolling_baseline_c2` v1: a period is flagged when its count exceeds the mean of 7 baseline periods
# (ending 3 periods earlier) by more than 3 standard deviations, is at least twice that mean and at least the
# minimum count, is not likely incomplete, is not a holiday week, and does not follow a missing or zero period.
# Seasonal diseases must also exceed the usual range for the time of year. Parameters are read from the published file.

# %%
flag_file = read_json(f"flags/{DISEASE}.json")
P = flag_file["params"]
overview = read_json(f"overview/{DISEASE}.json")
PTYPE, INCOMPLETE_FROM = overview["period_type"], overview["incomplete_from"]
SEASONAL = next(d for d in read_json("diseases.json")["diseases"] if d["id"] == DISEASE).get("seasonal") or False

def add_period(p, n):
    d = pd.Timestamp(p)
    d = d + pd.Timedelta(days=7 * n) if PTYPE == "W" else d + pd.DateOffset(months=n) if PTYPE == "M" else d + pd.DateOffset(years=n)
    return d.strftime("%Y-%m-%d")

def compute_flags(periods, values):
    look = dict(zip(periods, values))
    grid, p = [], min(periods)
    while p <= max(periods):
        grid.append(p); p = add_period(p, 1)
    y = np.array([look.get(g, np.nan) for g in grid], dtype=float)
    out, n, per_year = [], len(grid), 52 if PTYPE == "W" else 12
    for t in range(max(P["baseline_n"] + P["guard"], n - P["lookback_periods"]), n):
        if np.isnan(y[t]) or grid[t] >= INCOMPLETE_FROM:
            continue
        base = y[t - P["guard"] - P["baseline_n"]: t - P["guard"]]
        ok = base[~np.isnan(base)]
        if len(ok) < P["min_baseline_points"]:
            continue
        mean = ok.mean(); sd = ok.std(ddof=1) if len(ok) > 1 else 0.0
        sd = max(sd, np.sqrt(max(mean, 1.0)))
        if not (y[t] > mean + P["k"] * sd and y[t] >= P["min_count"][PTYPE] and y[t] >= P["min_ratio"] * mean):
            continue
        status = "flagged"
        if PTYPE == "W" and pd.Timestamp(grid[t]).isocalendar()[1] in P["holiday_iso_weeks"]:
            status = "suppressed-holiday-period"
        if status == "flagged" and (np.isnan(y[t - 1]) or y[t - 1] == 0) and mean > 0:
            status = "suppressed-possible-batch-reporting"
        if status == "flagged" and SEASONAL:
            w, hist, k = P["seasonal_window"], [], 1
            while t - k * per_year - w >= 0:
                seg = y[t - k * per_year - w: t - k * per_year + w + 1]; seg = seg[~np.isnan(seg)]
                if len(seg): hist.append(seg.mean())
                k += 1
            if len(hist) < P["seasonal_min_years"]:
                status = "suppressed-seasonal-baseline-unavailable"
            else:
                sm = np.mean(hist); ssd = max(np.std(hist, ddof=1) if len(hist) > 1 else 0.0, np.sqrt(max(sm, 1.0)))
                if y[t] <= sm + P["seasonal_k"] * ssd:
                    status = "suppressed-within-seasonal-range"
        out.append((grid[t], status))
    return out

default = ts[ts["is_default_series"]].copy()
default["period"] = pd.to_datetime(default["period_start"]).dt.strftime("%Y-%m-%d")
mine = set()
for iso3, g in default.groupby("iso3"):
    g = g.sort_values("period")
    for period, status in compute_flags(g["period"].tolist(), g["value"].tolist()):
        mine.add((iso3, period, status))
published = {(f["iso3"], f["period"], f["status"]) for f in flag_file["flags"]}
print(f"recomputed {len(mine)} flag decisions; published {len(published)}; identical: {mine == published}")
assert mine == published, "recomputed flags differ from the published ones"

# %% [markdown]
# ## 3. Load a specific snapshot
#
# The revision history stores every value that was new or different in each snapshot. The data "as of" a snapshot
# is the last stored value at or before it. Vintage reflects what this site retrieved and published, not necessarily
# when a source first released a number.

# %%
SNAPSHOT = manifest["snapshots"][0]["id"]  # the earliest snapshot; replace with any id from manifest["snapshots"]
rev = pd.read_parquet(f"{BASE}/bulk/revisions/disease={DISEASE}/revisions.parquet")
as_of = (rev[rev["snapshot_id"] <= SNAPSHOT].sort_values("snapshot_id", kind="stable")
         .drop_duplicates(["series_id", "period"], keep="last").dropna(subset=["value"]))
series_id = country["series_id"].iloc[0]
then = as_of[as_of["series_id"] == series_id].set_index("period")["value"]
now = country.assign(period=pd.to_datetime(country["period_start"]).dt.strftime("%Y-%m-%d")).set_index("period")["value"]
both = pd.concat([then.rename("as_of_snapshot"), now.rename("latest")], axis=1)
changed = both[(both["as_of_snapshot"] != both["latest"]) & ~(both["as_of_snapshot"].isna() & both["latest"].isna())]
print(f"snapshot {SNAPSHOT}: {len(then)} values for {series_id}; {len(changed)} differ from the latest snapshot")
print(changed.tail(10).to_string())

# %% [markdown]
# ## 4. Cite what you used

# %%
sources = {s["id"]: s for s in read_json("sources.json")["sources"]}
for sid in sorted(set(country["source_id"])):
    print("-", sources[sid]["citation"], "| License:", sources[sid]["license"])
print(f"- Understanding Outbreaks contributors. Understanding Outbreaks, snapshot {manifest['snapshot_id']}.")
