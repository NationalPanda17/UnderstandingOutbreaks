"""Reporting-lag estimation, 'likely incomplete' marking, and automated signal flags.

Signal flags are informational labels. They are not alerts, warnings, or judgments, and the wording used on
the site is fixed in the translation files ("Reported counts are unusually high compared with this place's
recent baseline (method X)").
"""
from __future__ import annotations

import datetime as dt
import math

import numpy as np
import pandas as pd

from .timeseries import period_add, periods_between

LAG_METHOD = {"name": "revision_lag", "version": "1"}
FLAG_METHOD = {"name": "rolling_baseline_c2", "version": "1"}
FLAG_PARAMS = {
    "baseline_n": 7,          # number of baseline periods
    "guard": 2,               # periods skipped between baseline and the tested period
    "k": 3.0,                 # threshold = mean + k * sd
    "min_count": {"W": 20, "M": 30},
    "min_ratio": 2.0,         # value must also be at least this multiple of the baseline mean
    "min_baseline_points": 5,
    "poisson_sd_floor": True,  # sd is never taken below sqrt(mean): protects low counts
    "holiday_iso_weeks": [52, 53, 1],
    "seasonal_window": 2,     # +/- periods around the same time of year
    "seasonal_min_years": 2,
    "seasonal_k": 3.0,
    "lookback_periods": 52,   # how far back flags are computed and published
}


# ----------------------------------------------------------------------------- reporting lag

def estimate_lag(history: pd.DataFrame, ptype: str, default_periods: int, snapshot_period: dict[str, str],
                 min_snapshots: int = 4, min_points: int = 30, rel_change: float = 0.05, cap: int = 12) -> dict:
    """Estimate how many recent periods are still being revised (method ``revision_lag`` v1).

    For every value that was revised by at least ``rel_change`` after it first appeared, take its age in
    periods at the snapshot of its *last* revision. The lag is the 90th percentile of those ages, at least the
    configured default and at most ``cap``. Until ``min_snapshots`` snapshots and ``min_points`` revised
    values exist, the configured default is used and the result says so.

    ``snapshot_period`` maps snapshot_id -> the period (of this ptype) that was current when it was taken.
    """
    base = {"method": LAG_METHOD["name"], "method_version": LAG_METHOD["version"], "period_type": ptype,
            "n_snapshots": 0, "n_revised_points": 0}
    if history is None or history.empty:
        return {**base, "lag_periods": default_periods, "basis": "configured-default"}
    snaps = sorted(history["snapshot_id"].unique())
    base["n_snapshots"] = len(snaps)
    h = history.sort_values("snapshot_id", kind="stable")
    cnt = h.groupby(["series_id", "period"])["value"].transform("size")
    rev = h[cnt >= 2].copy()
    if rev.empty or len(snaps) < min_snapshots:
        return {**base, "lag_periods": default_periods, "basis": "configured-default"}
    rev["prev"] = rev.groupby(["series_id", "period"])["value"].shift(1)
    rev = rev[rev["prev"].notna() & rev["value"].notna()]
    big = rev[(rev["value"] - rev["prev"]).abs() >= rel_change * rev[["value", "prev"]].abs().max(axis=1).clip(lower=1)]
    last = big.groupby(["series_id", "period"], as_index=False).last()
    base["n_revised_points"] = int(len(last))
    if len(last) < min_points:
        return {**base, "lag_periods": default_periods, "basis": "configured-default"}
    ages = [periods_between(p, snapshot_period[s], ptype) for p, s in zip(last["period"], last["snapshot_id"])]
    q = int(math.ceil(float(np.percentile(ages, 90))))
    return {**base, "lag_periods": int(min(max(q, default_periods), cap)), "basis": "estimated-from-revisions",
            "p90_age": q}


def incomplete_from(current: str, ptype: str, lag_periods: int) -> str:
    """First period that is treated as 'likely incomplete': the current period and the ``lag_periods`` before it."""
    return period_add(current, ptype, -lag_periods)


# ----------------------------------------------------------------------------- signal flags

def regular_grid(periods: list[str], values: list[float], ptype: str) -> tuple[list[str], np.ndarray]:
    """Fill gaps so that missing periods are NaN (missing data must look missing, and is never treated as zero)."""
    if not periods:
        return [], np.array([])
    look = dict(zip(periods, values))
    grid = []
    p = min(periods)
    last = max(periods)
    while p <= last:
        grid.append(p)
        p = period_add(p, ptype, 1)
    return grid, np.array([look.get(g, np.nan) for g in grid], dtype=float)


def compute_flags(periods: list[str], values: list[float], ptype: str, incomplete_start: str, seasonal: bool,
                  params: dict | None = None) -> list[dict]:
    """Rolling-baseline flags for one series (method ``rolling_baseline_c2`` v1, in the spirit of EARS C2).

    A period t is flagged when all of the following hold:
      * it is not 'likely incomplete' and has a reported value of at least ``min_count``;
      * at least ``min_baseline_points`` of the ``baseline_n`` periods ending ``guard``+1 periods before t have values;
      * value > mean + k * sd of that baseline (sd floored at sqrt(mean) so tiny counts cannot trigger),
        and value >= min_ratio * mean;
      * it is not a likely reporting artefact: not a holiday week, and not a value that follows a missing or zero
        period (a typical sign of batch reporting);
      * for seasonal diseases, it also exceeds mean + seasonal_k * sd of the same time of year in earlier years.
    Suppressed candidates are returned too, with ``status`` explaining why, so the decision is inspectable.
    """
    P = {**FLAG_PARAMS, **(params or {})}
    if ptype not in P["min_count"]:
        return []
    grid, y = regular_grid(periods, values, ptype)
    n = len(grid)
    out = []
    per_year = 52 if ptype == "W" else 12
    start = max(P["baseline_n"] + P["guard"], n - P["lookback_periods"])
    for t in range(start, n):
        if np.isnan(y[t]) or grid[t] >= incomplete_start:
            continue
        b0, b1 = t - P["guard"] - P["baseline_n"], t - P["guard"]
        base = y[b0:b1]
        ok = base[~np.isnan(base)]
        if len(ok) < P["min_baseline_points"]:
            continue
        mean = float(ok.mean())
        sd = float(ok.std(ddof=1)) if len(ok) > 1 else 0.0
        if P["poisson_sd_floor"]:
            sd = max(sd, math.sqrt(max(mean, 1.0)))
        thr = mean + P["k"] * sd
        if not (y[t] > thr and y[t] >= P["min_count"][ptype] and y[t] >= P["min_ratio"] * mean):
            continue
        status, notes = "flagged", []
        if ptype == "W" and dt.date.fromisoformat(grid[t]).isocalendar()[1] in P["holiday_iso_weeks"]:
            status = "suppressed-holiday-period"
        prev = y[t - 1]
        if status == "flagged" and (np.isnan(prev) or prev == 0) and mean > 0:
            status = "suppressed-possible-batch-reporting"
        seasonal_info = None
        if status == "flagged" and seasonal:
            w = P["seasonal_window"]
            hist = []
            k = 1
            while t - k * per_year - w >= 0:
                seg = y[t - k * per_year - w: t - k * per_year + w + 1]
                seg = seg[~np.isnan(seg)]
                if len(seg):
                    hist.append(float(seg.mean()))
                k += 1
            if len(hist) < P["seasonal_min_years"]:
                status = "suppressed-seasonal-baseline-unavailable"
            else:
                sm = float(np.mean(hist))
                ssd = max(float(np.std(hist, ddof=1)) if len(hist) > 1 else 0.0, math.sqrt(max(sm, 1.0)))
                sthr = sm + P["seasonal_k"] * ssd
                seasonal_info = {"years_used": len(hist), "mean": round(sm, 2), "sd": round(ssd, 2), "threshold": round(sthr, 2)}
                if y[t] <= sthr:
                    status = "suppressed-within-seasonal-range"
        out.append({
            "period": grid[t], "value": float(y[t]), "status": status,
            "baseline_mean": round(mean, 2), "baseline_sd": round(sd, 2), "threshold": round(thr, 2),
            "baseline_periods": [grid[b0], grid[b1 - 1]], "baseline_points": int(len(ok)),
            "seasonal": seasonal_info, "method": FLAG_METHOD["name"], "method_version": FLAG_METHOD["version"],
        })
    return out


def trend_summary(periods: list[str], values: list[float], ptype: str, incomplete_start: str) -> dict:
    """Latest complete value and change against the previous complete period.

    Periods that are likely incomplete never feed a percentage change or a trend arrow.
    """
    comp = [(p, v) for p, v in zip(periods, values) if p < incomplete_start and v is not None and not (isinstance(v, float) and math.isnan(v))]
    if not comp:
        return {"latest_complete": None}
    p, v = comp[-1]
    res = {"latest_complete": p, "value": v, "change_pct": None, "prev_period": None}
    if len(comp) >= 2 and periods_between(comp[-2][0], p, ptype) == 1 and comp[-2][1] and comp[-2][1] >= 10:
        res["prev_period"] = comp[-2][0]
        res["change_pct"] = round(100.0 * (v - comp[-2][1]) / comp[-2][1], 1)
    return res
