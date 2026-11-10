/** "Copy as code": Python (pandas), R (tidyverse) and SQL (DuckDB) that reproduce the exact current view.
 *
 * The generated code reads the published revision history at a fixed snapshot id, so it keeps returning the
 * same numbers after the site updates. tests/codegen.test.ts runs the generated code and compares it with
 * the on-screen values.
 */
import type { PType } from './data';
import type { TransformState } from './transforms';

export interface ViewSpec {
  disease: string;
  ptype: PType;
  snapshot: string;
  /** Absolute base of the data API, e.g. https://example.pages.dev/data/v1 */
  base: string;
  items: { seriesId: string; label: string; population: number | null; incompleteFrom?: string }[];
  transforms: TransformState;
  from?: string | null;
  to?: string | null;
  viewUrl?: string;
  sources: string[];
}

const header = (v: ViewSpec, c: string) => [
  `${c} UnderstandingOutbreaks: reproduces one view exactly (snapshot ${v.snapshot}).`,
  ...(v.viewUrl ? [`${c} View: ${v.viewUrl}`] : []),
  `${c} Sources: ${v.sources.join('; ')}. Licenses: see ${v.base}/sources.json`,
  `${c} Aggregated official public reports. Not a surveillance system; not medical advice.`,
].join('\n');

const FREQ: Record<PType, { py: string; r: string; sql: string }> = {
  W: { py: 'W-MON', r: 'week', sql: "INTERVAL 7 DAY" },
  M: { py: 'MS', r: 'month', sql: "INTERVAL 1 MONTH" },
  Y: { py: 'YS', r: 'year', sql: "INTERVAL 1 YEAR" },
};

export function pythonCode(v: ViewSpec): string {
  const t = v.transforms;
  const L: string[] = [];
  L.push(header(v, '#'));
  L.push('# Requires: pip install pandas pyarrow (plus fsspec aiohttp to read over https)');
  L.push('import pandas as pd', '');
  L.push(`BASE = ${JSON.stringify(v.base)}`);
  L.push(`SNAPSHOT = ${JSON.stringify(v.snapshot)}`);
  L.push('SERIES = {  # series_id: population used for per-capita rates');
  for (const it of v.items) L.push(`    ${JSON.stringify(it.seriesId)}: ${it.population ?? 'None'},  # ${it.label}`);
  L.push('}');
  if (t.excludeIncomplete) {
    L.push('INCOMPLETE_FROM = {  # first period marked "likely incomplete"');
    for (const it of v.items) L.push(`    ${JSON.stringify(it.seriesId)}: ${JSON.stringify(it.incompleteFrom ?? '9999-12-31')},`);
    L.push('}');
  }
  L.push('');
  L.push(`rev = pd.read_parquet(f"{BASE}/bulk/revisions/disease=${v.disease}/revisions.parquet")`);
  L.push('rev = rev[(rev["snapshot_id"] <= SNAPSHOT) & rev["series_id"].isin(SERIES)]');
  L.push('# the value published at the snapshot = the last change at or before it');
  L.push('rev = rev.sort_values("snapshot_id", kind="stable").drop_duplicates(["series_id", "period"], keep="last").dropna(subset=["value"])');
  L.push('');
  L.push('parts = []');
  L.push('for sid, population in SERIES.items():');
  L.push('    r = rev[rev["series_id"] == sid]');
  L.push('    if r.empty:');
  L.push('        continue');
  L.push('    s = pd.Series(r["value"].to_numpy(dtype=float), index=pd.to_datetime(r["period"])).sort_index()');
  L.push(`    s = s.asfreq(${JSON.stringify(FREQ[v.ptype].py)})  # missing periods become NaN, never zero`);
  L.push('    raw = s.copy()');
  if (t.excludeIncomplete) L.push('    s = s[s.index < pd.Timestamp(INCOMPLETE_FROM[sid])]  # drop periods marked likely incomplete');
  if (t.perCapita) L.push('    s = s / population * 1e5 if population else s * float("nan")  # per 100,000 people');
  if (t.rolling > 1) L.push(`    s = s.rolling(${t.rolling}, min_periods=${t.rolling}).mean()  # trailing ${t.rolling}-period average`);
  if (t.cumulative) L.push('    s = s.cumsum()  # running total; missing periods stay missing');
  if (t.rebase) L.push('    s = s / s.max() * 100  # percent of the series\' own peak');
  if (t.align) {
    L.push('    started = raw[raw > 0]');
    L.push('    s = s[s.index >= started.index[0]] if len(started) else s.iloc[0:0]  # start at the first reported value');
  }
  if (v.from) L.push(`    s = s[s.index >= pd.Timestamp(${JSON.stringify(v.from)})]`);
  if (v.to) L.push(`    s = s[s.index <= pd.Timestamp(${JSON.stringify(v.to)})]`);
  L.push('    parts.append(pd.DataFrame({"series_id": sid, "period": s.index.strftime("%Y-%m-%d"), "value": s.to_numpy()}))');
  L.push('');
  L.push('view = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=["series_id", "period", "value"])');
  if (t.align) L.push('view["periods_since_first_report"] = view.groupby("series_id").cumcount()');
  L.push('print(view)');
  return L.join('\n') + '\n';
}

export function rCode(v: ViewSpec): string {
  const t = v.transforms;
  const L: string[] = [];
  L.push(header(v, '#'));
  L.push('# Requires: install.packages(c("dplyr", "tidyr", "arrow"))');
  L.push('library(dplyr)', 'library(tidyr)', 'library(arrow)', '');
  L.push(`BASE <- ${JSON.stringify(v.base)}`);
  L.push(`SNAPSHOT <- ${JSON.stringify(v.snapshot)}`);
  L.push('SERIES <- c(  # series_id = population used for per-capita rates');
  L.push(v.items.map((it) => `  ${JSON.stringify(it.seriesId)} = ${it.population ?? 'NA'}`).join(',\n'));
  L.push(')');
  if (t.excludeIncomplete) {
    L.push('INCOMPLETE_FROM <- c(');
    L.push(v.items.map((it) => `  ${JSON.stringify(it.seriesId)} = ${JSON.stringify(it.incompleteFrom ?? '9999-12-31')}`).join(',\n'));
    L.push(')');
  }
  L.push('');
  L.push('uo_read <- function(path) {');
  L.push('  if (grepl("^https?://", path)) { tmp <- tempfile(fileext = ".parquet"); download.file(path, tmp, mode = "wb", quiet = TRUE); path <- tmp }');
  L.push('  as.data.frame(read_parquet(path))');
  L.push('}');
  L.push(`rev <- uo_read(paste0(BASE, "/bulk/revisions/disease=${v.disease}/revisions.parquet")) |>`);
  L.push('  filter(snapshot_id <= SNAPSHOT, series_id %in% names(SERIES)) |>');
  L.push('  arrange(snapshot_id) |>');
  L.push('  group_by(series_id, period) |> slice_tail(n = 1) |> ungroup() |>  # value published at the snapshot');
  L.push('  filter(!is.na(value)) |>');
  L.push('  mutate(period = as.Date(period))');
  L.push('');
  L.push('view <- rev |>');
  L.push('  select(series_id, period, value) |>');
  L.push('  group_by(series_id) |>');
  L.push(`  complete(period = seq(min(period), max(period), by = ${JSON.stringify(FREQ[v.ptype].r)})) |>  # missing periods become NA, never zero`);
  L.push('  arrange(period, .by_group = TRUE) |>');
  L.push('  mutate(raw = value)');
  if (t.excludeIncomplete) L.push('view <- view |> filter(period < as.Date(INCOMPLETE_FROM[series_id]))  # drop periods marked likely incomplete');
  if (t.perCapita) L.push('view <- view |> mutate(value = value / SERIES[series_id] * 1e5)  # per 100,000 people');
  if (t.rolling > 1) L.push(`view <- view |> mutate(value = as.numeric(stats::filter(value, rep(1 / ${t.rolling}, ${t.rolling}), sides = 1)))  # trailing ${t.rolling}-period average`);
  if (t.cumulative) L.push('view <- view |> mutate(value = ifelse(is.na(value), NA_real_, cumsum(coalesce(value, 0))))  # running total');
  if (t.rebase) L.push('view <- view |> mutate(value = value / max(value, na.rm = TRUE) * 100)  # percent of own peak');
  if (t.align) L.push('view <- view |> filter(any(raw > 0, na.rm = TRUE)) |> filter(row_number() >= which(raw > 0)[1]) |> mutate(periods_since_first_report = row_number() - 1)');
  if (v.from) L.push(`view <- view |> filter(period >= as.Date(${JSON.stringify(v.from)}))`);
  if (v.to) L.push(`view <- view |> filter(period <= as.Date(${JSON.stringify(v.to)}))`);
  L.push('view <- view |> ungroup() |> select(-raw) |> mutate(period = format(period, "%Y-%m-%d"))');
  L.push('print(view)');
  return L.join('\n') + '\n';
}

export function sqlCode(v: ViewSpec): string {
  const t = v.transforms;
  const q = (s: string) => "'" + s.replace(/'/g, "''") + "'";
  const ids = v.items.map((it) => q(it.seriesId)).join(', ');
  const caseOf = (f: (it: ViewSpec['items'][number]) => string) => 'CASE series_id ' + v.items.map((it) => `WHEN ${q(it.seriesId)} THEN ${f(it)}`).join(' ') + ' END';
  const L: string[] = [];
  L.push(header(v, '--'));
  L.push('-- DuckDB SQL. Runs in the SQL console on this site, or locally with the duckdb CLI.');
  // Each CTE is kept as (comment, sql) so that commas between CTEs never end up inside a trailing comment.
  const ctes: { note?: string; sql: string }[] = [];
  ctes.push({ note: 'the value published at the snapshot = the last stored change at or before it', sql: `latest AS (\n  SELECT series_id, CAST(period AS DATE) AS period, value\n  FROM read_parquet(${q(`${v.base}/bulk/revisions/disease=${v.disease}/revisions.parquet`)})\n  WHERE snapshot_id <= ${q(v.snapshot)} AND series_id IN (${ids})\n  QUALIFY row_number() OVER (PARTITION BY series_id, period ORDER BY snapshot_id DESC) = 1\n)` });
  ctes.push({ sql: 'vals AS (SELECT * FROM latest WHERE value IS NOT NULL)' });
  ctes.push({ sql: 'bounds AS (SELECT series_id, min(period) AS a, max(period) AS b FROM vals GROUP BY 1)' });
  ctes.push({ sql: `grid AS (SELECT b.series_id, CAST(g.period AS DATE) AS period FROM bounds b, generate_series(b.a, b.b, ${FREQ[v.ptype].sql}) AS g(period))` });
  ctes.push({ note: 'missing periods are NULL, never zero', sql: 's0 AS (SELECT g.series_id, g.period, v.value AS raw, v.value AS value FROM grid g LEFT JOIN vals v USING (series_id, period))' });
  let prev = 's0';
  let n = 0;
  const step = (sql: string, note: string) => { n += 1; ctes.push({ note, sql: `s${n} AS (${sql.replace(/\$prev/g, prev)})` }); prev = `s${n}`; };
  if (t.excludeIncomplete) step(`SELECT * FROM $prev WHERE period < ${caseOf((it) => `DATE ${q(it.incompleteFrom ?? '9999-12-31')}`)}`, 'drop periods marked likely incomplete');
  if (t.perCapita) step(`SELECT series_id, period, raw, value / ${caseOf((it) => (it.population ? String(it.population) : 'NULL'))} * 1e5 AS value FROM $prev`, 'per 100,000 people');
  if (t.rolling > 1) step(`SELECT series_id, period, raw, CASE WHEN count(value) OVER w = ${t.rolling} THEN avg(value) OVER w END AS value FROM $prev WINDOW w AS (PARTITION BY series_id ORDER BY period ROWS BETWEEN ${t.rolling - 1} PRECEDING AND CURRENT ROW)`, `trailing ${t.rolling}-period average; blank when a period in the window is missing`);
  if (t.cumulative) step('SELECT series_id, period, raw, CASE WHEN value IS NULL THEN NULL ELSE sum(value) OVER (PARTITION BY series_id ORDER BY period) END AS value FROM $prev', 'running total');
  if (t.rebase) step('SELECT series_id, period, raw, value / nullif(max(value) OVER (PARTITION BY series_id), 0) * 100 AS value FROM $prev', 'percent of own peak');
  if (t.align) step('SELECT * FROM $prev p WHERE period >= (SELECT min(period) FROM s0 x WHERE x.series_id = p.series_id AND x.raw > 0)', 'start at the first reported value');
  L.push('WITH ' + ctes.map((c) => (c.note ? `-- ${c.note}\n` : '') + c.sql).join(',\n'));
  const where: string[] = [];
  if (v.from) where.push(`period >= DATE ${q(v.from)}`);
  if (v.to) where.push(`period <= DATE ${q(v.to)}`);
  L.push(`SELECT series_id, strftime(period, '%Y-%m-%d') AS period, value${t.align ? ', row_number() OVER (PARTITION BY series_id ORDER BY period) - 1 AS periods_since_first_report' : ''}`);
  L.push(`FROM ${prev}${where.length ? ' WHERE ' + where.join(' AND ') : ''}`);
  L.push('ORDER BY series_id, period;');
  return L.join('\n') + '\n';
}

export function codeFor(lang: 'python' | 'r' | 'sql', v: ViewSpec): string {
  return lang === 'python' ? pythonCode(v) : lang === 'r' ? rCode(v) : sqlCode(v);
}
