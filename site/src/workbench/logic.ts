/** Workbench logic: pure functions (CSV parsing, pivot, snapshot diff, safeguard checks, overlay validation, SQL builder).
 *  No DOM and no heavy runtimes here, so everything is unit-tested and stays out of tool-runtime chunks. */

export type Cell = string | number | boolean | null;
export type Table = { columns: string[]; rows: Record<string, Cell>[] };

// ---------------------------------------------------------------- CSV

export function parseCSV(text: string, delimiter?: string): { columns: string[]; rows: string[][] } {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.indexOf('\n') < 0 ? src.length : src.indexOf('\n'));
  const d = delimiter ?? ([',', ';', '\t'].map((c) => [c, firstLine.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0]);
  const out: string[][] = [];
  let row: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') out.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.length > 1 || row[0] !== '') out.push(row); }
  const columns = (out.shift() ?? []).map((c) => c.trim());
  return { columns, rows: out };
}

export async function fetchCsvGz(url: string): Promise<{ columns: string[]; rows: string[][] }> {
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok || !r.body) throw new Error(`${r.status} ${url}`);
  // Some hosts send .gz files with Content-Encoding: gzip, so the browser has already decompressed them;
  // others send the raw gzip bytes. Check the gzip magic number rather than trusting either behaviour.
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return parseCSV(new TextDecoder().decode(bytes), ',');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return parseCSV(await new Response(stream).text(), ',');
}

// ---------------------------------------------------------------- user overlay

export interface OverlayMapping { place: string | null; date: string; value: string }
export interface OverlayResult { points: { place: string; date: string; value: number }[]; errors: string[]; warnings: string[]; skipped: number }

/** Parse a date in ISO (YYYY-MM-DD, YYYY-MM, YYYY), or D/M/Y and M/D/Y when unambiguous. Returns ISO date or null. */
export function parseDate(s: string): string | null {
  const v = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{4})-(\d{1,2})$/.exec(v);
  if (m) return valid(+m[1], +m[2], 1);
  m = /^(\d{4})$/.exec(v);
  if (m) return valid(+m[1], 1, 1);
  m = /^(\d{4})-W(\d{1,2})$/i.exec(v);
  if (m) { const jan4 = new Date(Date.UTC(+m[1], 0, 4)); const day = jan4.getUTCDay() || 7; jan4.setUTCDate(jan4.getUTCDate() - day + 1 + (+m[2] - 1) * 7); return jan4.toISOString().slice(0, 10); }
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(v);
  if (m) {
    const a = +m[1]; const b = +m[2];
    if (a > 12 && b <= 12) return valid(+m[3], b, a);
    if (b > 12 && a <= 12) return valid(+m[3], a, b);
    return null; // ambiguous day/month order: rejected rather than guessed
  }
  return null;
}
function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 1900 || y > 2100) return null;
  return dt.toISOString().slice(0, 10);
}

export function guessMapping(columns: string[]): OverlayMapping {
  const find = (re: RegExp) => columns.find((c) => re.test(c.toLowerCase())) ?? null;
  return { place: find(/place|country|iso|region|site|school|clinic|location|name/), date: find(/date|week|month|period|day|time|year/) ?? columns[0], value: find(/value|count|cases|n$|number|total/) ?? columns[columns.length - 1] };
}

export function validateOverlay(csv: { columns: string[]; rows: string[][] }, map: OverlayMapping, maxRows = 50000): OverlayResult {
  const errors: string[] = []; const warnings: string[] = [];
  const ix = (c: string | null) => (c === null ? -1 : csv.columns.indexOf(c));
  const di = ix(map.date); const vi = ix(map.value); const pi = ix(map.place);
  if (!csv.columns.length) errors.push('empty');
  if (di < 0) errors.push('noDate');
  if (vi < 0) errors.push('noValue');
  if (di >= 0 && di === vi) errors.push('sameColumn');
  if (csv.rows.length > maxRows) errors.push('tooManyRows');
  if (errors.length) return { points: [], errors, warnings, skipped: 0 };
  const points: OverlayResult['points'] = []; let skipped = 0; let ambiguous = 0; let negative = 0;
  for (const r of csv.rows) {
    const date = parseDate(r[di] ?? '');
    const raw = (r[vi] ?? '').trim().replace(/\s/g, '');
    const value = raw === '' ? NaN : Number(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw) ? raw.replace(/,/g, '') : raw.replace(',', '.'));
    if (!date) { skipped++; if (/^\d{1,2}[/.]\d{1,2}[/.]\d{4}$/.test((r[di] ?? '').trim())) ambiguous++; continue; }
    if (!Number.isFinite(value)) { skipped++; continue; }
    if (value < 0) negative++;
    points.push({ place: pi >= 0 ? (r[pi] ?? '').trim() : '', date, value });
  }
  if (!points.length) errors.push('noValidRows');
  if (ambiguous) warnings.push('ambiguousDates');
  if (negative) warnings.push('negativeValues');
  if (skipped) warnings.push('skippedRows');
  points.sort((a, b) => (a.place === b.place ? (a.date < b.date ? -1 : 1) : a.place < b.place ? -1 : 1));
  return { points, errors, warnings, skipped };
}

// ---------------------------------------------------------------- safeguards

export interface Safeguard { code: 'mixed-definitions' | 'mixed-sources' | 'incomplete-included' | 'cross-disease'; detail: string[] }

/** Check a set of rows for combinations that must not pass silently. `groupCols` are the columns a result is grouped by. */
export function rowSafeguards(rows: Record<string, Cell>[], groupCols: string[] = []): Safeguard[] {
  const out: Safeguard[] = [];
  const distinct = (c: string) => Array.from(new Set(rows.map((r) => r[c]).filter((x) => x !== null && x !== undefined && x !== ''))).map(String);
  const has = (c: string) => rows.length > 0 && c in rows[0];
  if (has('case_definition') && !groupCols.includes('case_definition') && !groupCols.includes('series_id')) { const d = distinct('case_definition'); if (d.length > 1) out.push({ code: 'mixed-definitions', detail: d }); }
  if (has('source_id') && !groupCols.includes('source_id') && !groupCols.includes('series_id') && !groupCols.includes('dataset_id')) { const d = distinct('source_id'); if (d.length > 1) out.push({ code: 'mixed-sources', detail: d }); }
  if (has('likely_incomplete') && rows.some((r) => r.likely_incomplete === true || r.likely_incomplete === 'true' || r.likely_incomplete === 'True')) out.push({ code: 'incomplete-included', detail: [] });
  if (has('disease') && !groupCols.includes('disease')) { const d = distinct('disease'); if (d.length > 1) out.push({ code: 'cross-disease', detail: d }); }
  return out;
}

/** Static check of SQL text against the timeseries tables: which protective filters are absent? */
export function sqlSafeguards(sql: string): Safeguard[] {
  const s = sql.toLowerCase().replace(/--.*$/gm, '');
  const out: Safeguard[] = [];
  if (!/timeseries|revisions/.test(s)) return out;
  const pinsSeries = /series_id\s*(=|in)/.test(s) || /is_default_series/.test(s);
  if (/timeseries/.test(s)) {
    if (!pinsSeries && !/case_definition/.test(s)) out.push({ code: 'mixed-definitions', detail: [] });
    if (!pinsSeries && !/source_id|dataset_id/.test(s)) out.push({ code: 'mixed-sources', detail: [] });
    if (!/likely_incomplete/.test(s)) out.push({ code: 'incomplete-included', detail: [] });
  }
  const diseases = Array.from(new Set(Array.from(s.matchAll(/disease=([a-z0-9_]+)/g)).map((m) => m[1])));
  if (diseases.length > 1) out.push({ code: 'cross-disease', detail: diseases });
  return out;
}

// ---------------------------------------------------------------- visual query builder

export interface QuerySpec {
  dataset: 'timeseries' | 'events' | 'flags' | 'revisions';
  disease: string;
  columns: string[];
  filters: { column: string; op: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'IN'; value: string }[];
  groupBy: string[];
  aggregate: { fn: 'sum' | 'avg' | 'max' | 'min' | 'count'; column: string } | null;
  comparableOnly: boolean;
  excludeIncomplete: boolean;
  snapshot: string | null;
  limit: number;
}

const ident = (c: string) => (/^[a-z_][a-z0-9_]*$/i.test(c) ? c : '"' + c.replace(/"/g, '""') + '"');
const lit = (v: string) => (/^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : /^(true|false)$/i.test(v.trim()) ? v.trim().toLowerCase() : "'" + v.replace(/'/g, "''") + "'");

export function datasetPath(base: string, dataset: QuerySpec['dataset'], disease: string): string {
  if (dataset === 'timeseries') return `${base}/bulk/timeseries/disease=${disease}/data.parquet`;
  if (dataset === 'revisions') return `${base}/bulk/revisions/disease=${disease}/revisions.parquet`;
  if (dataset === 'events') return `${base}/bulk/events/events.parquet`;
  return `${base}/bulk/flags/flags.parquet`;
}

/** Generate readable SQL from the visual builder, so beginners can learn from it. Only whitelisted shapes are produced. */
export function buildSQL(q: QuerySpec, base: string): string {
  const where: string[] = [];
  if (q.dataset === 'timeseries') {
    if (q.comparableOnly) where.push('is_default_series  -- one comparable series per country');
    if (q.excludeIncomplete) where.push('NOT likely_incomplete  -- leave out periods still being reported');
  }
  if (q.dataset === 'events' && q.disease && q.disease !== '*') where.push(`disease = ${lit(q.disease)}`);
  if (q.dataset === 'flags' && q.disease && q.disease !== '*') where.push(`disease = ${lit(q.disease)}`);
  for (const f of q.filters) {
    if (!f.column || f.value === '') continue;
    if (f.op === 'IN') where.push(`${ident(f.column)} IN (${f.value.split(',').map((x) => lit(x.trim())).join(', ')})`);
    else where.push(`${ident(f.column)} ${f.op} ${lit(f.value)}`);
  }
  const group = q.groupBy.map(ident);
  let select: string;
  if (q.aggregate) {
    const agg = q.aggregate.fn === 'count' ? 'count(*)' : `${q.aggregate.fn}(${ident(q.aggregate.column)})`;
    select = [...group, `${agg} AS ${q.aggregate.fn}_${q.aggregate.column.replace(/[^a-z0-9_]/gi, '_')}`].join(', ');
  } else select = q.columns.length ? q.columns.map(ident).join(', ') : '*';
  const lines: string[] = [];
  let from = `read_parquet('${datasetPath(base, q.dataset, q.disease)}')`;
  if (q.dataset === 'timeseries' && q.snapshot) {
    // a pinned snapshot is rebuilt from the revision history; the latest file supplies the descriptive columns
    lines.push('WITH asof AS (');
    lines.push('  SELECT series_id, period, value');
    lines.push(`  FROM read_parquet('${datasetPath(base, 'revisions', q.disease)}')`);
    lines.push(`  WHERE snapshot_id <= '${q.snapshot.replace(/'/g, "''")}'`);
    lines.push('  QUALIFY row_number() OVER (PARTITION BY series_id, period ORDER BY snapshot_id DESC) = 1');
    lines.push('), pinned AS (');
    lines.push(`  SELECT t.* REPLACE (a.value AS value, a.value / t.population * 1e5 AS rate_per_100k, '${q.snapshot.replace(/'/g, "''")}' AS snapshot_id)`);
    lines.push(`  FROM ${from} t JOIN asof a ON a.series_id = t.series_id AND a.period = strftime(t.period_start, '%Y-%m-%d')`);
    lines.push('  WHERE a.value IS NOT NULL');
    lines.push(')');
    from = 'pinned';
  }
  lines.push(`SELECT ${select}`);
  lines.push(`FROM ${from}`);
  if (where.length) lines.push('WHERE ' + where.join('\n  AND '));
  if (q.aggregate && group.length) lines.push('GROUP BY ' + group.join(', '));
  if (q.aggregate && group.length) lines.push('ORDER BY ' + group.join(', '));
  else if (q.dataset === 'timeseries' || q.dataset === 'revisions') lines.push(q.dataset === 'timeseries' ? 'ORDER BY iso3, period_start' : 'ORDER BY series_id, period, snapshot_id');
  lines.push(`LIMIT ${Math.max(1, Math.min(100000, Math.floor(q.limit) || 1000))};`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- pivot

export interface PivotSpec { rows: string; cols: string | null; value: string; fn: 'sum' | 'mean' | 'max' | 'count' }
export interface PivotResult { rowKeys: string[]; colKeys: string[]; cells: Record<string, Record<string, number | null>>; rowTotals: Record<string, number | null> }

export function pivot(rows: Record<string, Cell>[], spec: PivotSpec): PivotResult {
  const acc = new Map<string, Map<string, { s: number; n: number; mx: number }>>();
  const cols = new Set<string>();
  for (const r of rows) {
    const rk = String(r[spec.rows] ?? '');
    const ck = spec.cols ? String(r[spec.cols] ?? '') : 'value';
    const v = r[spec.value];
    const num = typeof v === 'number' ? v : v === null || v === '' || v === undefined ? NaN : Number(v);
    if (spec.fn !== 'count' && !Number.isFinite(num)) continue; // missing values are skipped, never counted as zero
    cols.add(ck);
    if (!acc.has(rk)) acc.set(rk, new Map());
    const m = acc.get(rk)!;
    const c = m.get(ck) ?? { s: 0, n: 0, mx: -Infinity };
    c.s += Number.isFinite(num) ? num : 0; c.n += 1; c.mx = Math.max(c.mx, Number.isFinite(num) ? num : -Infinity);
    m.set(ck, c);
  }
  const fin = (c: { s: number; n: number; mx: number } | undefined): number | null => (!c ? null : spec.fn === 'sum' ? c.s : spec.fn === 'mean' ? c.s / c.n : spec.fn === 'max' ? c.mx : c.n);
  const rowKeys = Array.from(acc.keys()).sort();
  const colKeys = Array.from(cols).sort();
  const cells: PivotResult['cells'] = {}; const rowTotals: PivotResult['rowTotals'] = {};
  for (const rk of rowKeys) {
    cells[rk] = {};
    let tot = { s: 0, n: 0, mx: -Infinity };
    for (const ck of colKeys) {
      const c = acc.get(rk)!.get(ck);
      cells[rk][ck] = fin(c);
      if (c) tot = { s: tot.s + c.s, n: tot.n + c.n, mx: Math.max(tot.mx, c.mx) };
    }
    rowTotals[rk] = tot.n ? fin(tot) : null;
  }
  return { rowKeys, colKeys, cells, rowTotals };
}

// ---------------------------------------------------------------- snapshot diff

export interface DiffRow { series_id: string; period: string; a: number | null; b: number | null; change: number | null; kind: 'revised' | 'new' | 'removed' }

/** Compare two snapshots from stored changes. `changes`: skey -> period -> [[snapshotIndex, value|null], ...] (ascending).
 *  Values that never changed after first publication are not in `changes`; `base` is the snapshot index the series first appeared in. */
export function diffSnapshots(changes: Record<string, Record<string, [number, number | null][]>>, iso3: string, ia: number, ib: number): DiffRow[] {
  const out: DiffRow[] = [];
  const at = (h: [number, number | null][], i: number): number | null => { let v: number | null = null; for (const [si, x] of h) if (si <= i) v = x; return v; };
  for (const [skey, periods] of Object.entries(changes)) {
    for (const [period, h] of Object.entries(periods)) {
      const a = at(h, ia); const b = at(h, ib);
      if (a === b) continue;
      out.push({ series_id: `${skey}.${iso3}`, period, a, b, change: a !== null && b !== null ? b - a : null, kind: a === null ? 'new' : b === null ? 'removed' : 'revised' });
    }
  }
  return out.sort((x, y) => (x.series_id === y.series_id ? (x.period < y.period ? -1 : 1) : x.series_id < y.series_id ? -1 : 1));
}

// ---------------------------------------------------------------- event changes between snapshots

export interface EventState { snapshot_id: string; status: string; cases: number | null; deaths: number | null; n_reports: number; last_report: string; countries: string[] }
export interface EventChange { event_id: string; disease: string; countries: string[]; kind: 'new' | 'changed'; before: EventState | null; after: EventState; what: ('status' | 'cases' | 'deaths' | 'notices' | 'countries')[] }

/** What an event looked like at a snapshot: its last recorded state at or before that snapshot, or null if the
 *  event did not exist yet. Snapshot ids are UTC timestamps, so they compare as text. */
export function eventStateAt(history: EventState[], snapshot: string): EventState | null {
  let out: EventState | null = null;
  for (const h of history) if (h.snapshot_id <= snapshot) out = h;
  return out;
}

/** Events that are new, or whose status, stated counts, notices or countries differ, between two snapshots. */
export function diffEvents(events: Record<string, { disease: string; countries: string[]; history: EventState[] }>, a: string, b: string): EventChange[] {
  const out: EventChange[] = [];
  for (const [event_id, e] of Object.entries(events)) {
    const before = eventStateAt(e.history, a); const after = eventStateAt(e.history, b);
    if (!after) continue;
    if (!before) { out.push({ event_id, disease: e.disease, countries: after.countries, kind: 'new', before: null, after, what: [] }); continue; }
    const what: EventChange['what'] = [];
    if (before.status !== after.status) what.push('status');
    if (before.cases !== after.cases) what.push('cases');
    if (before.deaths !== after.deaths) what.push('deaths');
    if (before.n_reports !== after.n_reports) what.push('notices');
    if (before.countries.join() !== after.countries.join()) what.push('countries');
    if (what.length) out.push({ event_id, disease: e.disease, countries: after.countries, kind: 'changed', before, after, what });
  }
  return out.sort((x, y) => (x.after.last_report < y.after.last_report ? 1 : x.after.last_report > y.after.last_report ? -1 : x.event_id < y.event_id ? -1 : 1));
}

// ---------------------------------------------------------------- selections

/** Sum several places' series on their shared periods; a period is kept only if every selected place has a value. */
export function aggregateSeries(list: { p: string[]; v: (number | null)[] }[]): { p: string[]; v: (number | null)[]; coverage: number[] } {
  const all = Array.from(new Set(list.flatMap((s) => s.p))).sort();
  const maps = list.map((s) => new Map(s.p.map((p, i) => [p, s.v[i]])));
  const v: (number | null)[] = []; const coverage: number[] = [];
  for (const p of all) {
    let s = 0; let n = 0;
    for (const m of maps) { const x = m.get(p); if (x !== null && x !== undefined) { s += x; n++; } }
    coverage.push(n);
    v.push(n === list.length ? s : null);
  }
  return { p: all, v, coverage };
}
