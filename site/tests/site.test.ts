/** Frontend tests: transforms, copy-as-code (generated code is executed), exports and provenance, workbench logic and
 *  safeguards, pinned-view reconstruction, trace panels, watchlists, and the simulation boundaries. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { h, render } from 'preact';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { codeFor, type ViewSpec } from '../src/lib/codegen';
import { reconstructAsOf, regularize, type Core, type TsFile } from '../src/lib/data';
import { buildBundle, caption, composeExportSVG, imageMeta, seriesRows, toCSV, zip } from '../src/lib/exporters';
import { loadLocale, t } from '../src/lib/i18n';
import { provBlock, seriesProv, type Prov } from '../src/lib/prov';
import { NO_TRANSFORMS, applyTransforms, cumulative, perCapita, rebaseToPeak, rolling, transformsFromParam, transformsToParam, yearOverYear, type SeriesData, type TransformState } from '../src/lib/transforms';
import { decodeWatch, encodeWatch, parseWatchFile } from '../src/pages/Watchlists';
import { aggregateSeries, buildSQL, diffSnapshots, guessMapping, parseCSV, parseDate, pivot, rowSafeguards, sqlSafeguards, validateOverlay, type QuerySpec } from '../src/workbench/logic';
import { PRESETS, METHOD_REFERENCES } from '../src/sim/engine/presets';
import { simProv } from '../src/sim/ui/common';
import { AppCtx, SourceChip } from '../src/components/SourceChip';
import { comparabilityIssues } from '../src/components/ChartCard';
import { parseRoute, href } from '../src/lib/app';

const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'public', 'data', 'v1');
const PY = join(ROOT, '..', '.venv', 'bin', 'python');
const hasData = existsSync(join(DATA, 'manifest.json'));
const J = (p: string) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));

function loadCoreFromDisk(): Core {
  const manifest = J('manifest.json'); const src = J('sources.json'); const dis = J('diseases.json'); const pl = J('places.json');
  const sources: any = {}; for (const s of src.sources) sources[s.id] = s;
  const diseaseById: any = {}; const seriesByKey: any = {};
  for (const d of dis.diseases) { diseaseById[d.id] = d; for (const s of d.series) seriesByKey[s.skey] = { ...s, disease: d.id }; }
  return { manifest, sources, diseases: dis.diseases, diseaseById, places: pl.places, seriesByKey, chains: J('chains.json').chains, fetches: { ...J('fetches.json').fetches, ...pl.fetches }, reconciliation: dis.reconciliation };
}

beforeAll(async () => { await loadLocale('en'); });

describe('transform panel', () => {
  const v = [1, 2, null, 4, 5, 6];
  it('per-capita, cumulative, rolling, rebase', () => {
    expect(perCapita([50, null], 1_000_000)).toEqual([5, null]);
    expect(perCapita([50], null)).toEqual([null]);
    expect(cumulative(v)).toEqual([1, 3, null, 7, 12, 18]);
    expect(rolling(v, 2)).toEqual([null, 1.5, null, null, 4.5, 5.5]); // a window with a gap stays blank
    expect(rebaseToPeak([5, 10, null])).toEqual([50, 100, null]);
  });
  it('applies transforms in the documented order and aligns by first report', () => {
    const s: SeriesData = { id: 'a', label: 'a', p: ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'], v: [0, 0, 10, 30], ptype: 'W', population: 1000, incompleteFrom: '2026-01-26' };
    const out = applyTransforms(s, { ...NO_TRANSFORMS, perCapita: true, cumulative: true, align: true, excludeIncomplete: true });
    expect(out.p).toEqual(['2026-01-19']); expect(out.v).toEqual([1000]);
    expect(applyTransforms(s, NO_TRANSFORMS).v).toEqual(s.v);
  });
  it('round-trips through the URL parameter', () => {
    const tr: TransformState = { perCapita: true, rolling: 7, cumulative: false, rebase: true, align: false, log: true, excludeIncomplete: true };
    expect(transformsFromParam(transformsToParam(tr))).toEqual(tr);
    expect(transformsFromParam('none')).toEqual(NO_TRANSFORMS);
  });
  it('year-over-year uses ISO weeks and months', () => {
    const y = yearOverYear(['2024-12-30', '2025-01-06', '2026-01-05'], [1, 2, 3], 'W');
    expect(y.map((r) => r.year)).toEqual([2025, 2026]); expect(y[0].x).toEqual([1, 2]);
  });
  it('regularize makes missing periods explicit nulls', () => {
    expect(regularize(['2026-01-05', '2026-01-19'], [1, 2], 'W')).toEqual({ p: ['2026-01-05', '2026-01-12', '2026-01-19'], v: [1, null, 2] });
    expect(regularize(['2026-01-01', '2026-03-01'], [1, 2], 'M').p).toHaveLength(3);
  });
});

describe.skipIf(!hasData)('copy as code reproduces the on-screen numbers', () => {
  const cases: [string, string, string[], Partial<TransformState>][] = [
    ['measles monthly, plain', 'measles', ['KEN', 'ETH'], {}],
    ['measles per capita + rolling + exclude incomplete', 'measles', ['KEN', 'ETH'], { perCapita: true, rolling: 3, excludeIncomplete: true }],
    ['covid weekly cumulative + align', 'covid19', ['BRA'], { cumulative: true, align: true }],
    ['mpox weekly rebase + rolling', 'mpox', ['COD', 'BDI'], { rebase: true, rolling: 4 }],
  ];
  const setup = (disease: string, isos: string[], patch: Partial<TransformState>) => {
    const core = loadCoreFromDisk(); const d = core.diseaseById[disease]; const skey = d.default_skey!; const meta = core.seriesByKey[skey];
    const tr = { ...NO_TRANSFORMS, ...patch };
    const series: SeriesData[] = isos.map((iso3) => { const ts: TsFile = J(`ts/${disease}/${iso3}.json`); const r = regularize(ts.series[skey].p, ts.series[skey].v, meta.period_type); return { id: `${skey}.${iso3}`, label: iso3, p: r.p, v: r.v, ptype: meta.period_type, population: core.places[iso3].population, incompleteFrom: meta.lag.incomplete_from, skey, iso3 }; });
    const shown = series.map((s) => applyTransforms(s, tr));
    const spec: ViewSpec = { disease, ptype: meta.period_type, snapshot: core.manifest.snapshot_id, base: DATA, items: series.map((s) => ({ seriesId: s.id, label: s.label, population: s.population ?? null, incompleteFrom: s.incompleteFrom })), transforms: tr, sources: ['test'] };
    const expected = new Map<string, number | null>(); shown.forEach((s) => s.p.forEach((p, i) => expected.set(`${s.id}|${p}`, s.v[i])));
    return { spec, expected };
  };
  const compare = (rows: [string, string, number | null][], expected: Map<string, number | null>) => {
    expect(rows.length).toBe(expected.size);
    for (const [sid, period, value] of rows) {
      const e = expected.get(`${sid}|${period}`);
      expect(e, `${sid} ${period}`).not.toBeUndefined();
      if (e === null || e === undefined) expect(value === null || Number.isNaN(value)).toBe(true);
      else expect(Math.abs((value as number) - e) <= 1e-9 * Math.max(1, Math.abs(e)), `${sid} ${period}: ${value} vs ${e}`).toBe(true);
    }
  };
  for (const [name, disease, isos, patch] of cases) {
    it(`Python (pandas): ${name}`, () => {
      const { spec, expected } = setup(disease, isos, patch);
      const dir = mkdtempSync(join(tmpdir(), 'uo-code-')); const file = join(dir, 'view.py');
      writeFileSync(file, codeFor('python', spec).replace('print(view)', 'import json; print(json.dumps([[r.series_id, r.period, None if r.value != r.value else float(r.value)] for r in view.itertuples()]))'));
      compare(JSON.parse(execFileSync(PY, [file], { maxBuffer: 64e6 }).toString()), expected);
    });
    it(`SQL (DuckDB): ${name}`, () => {
      const { spec, expected } = setup(disease, isos, patch);
      const dir = mkdtempSync(join(tmpdir(), 'uo-code-')); const sqlFile = join(dir, 'view.sql'); writeFileSync(sqlFile, codeFor('sql', spec));
      const out = execFileSync(PY, ['-c', `import duckdb, json, sys\nrows = duckdb.sql(open(sys.argv[1]).read()).fetchall()\nprint(json.dumps([[r[0], r[1], None if r[2] is None or r[2] != r[2] else float(r[2])] for r in rows]))`, sqlFile], { maxBuffer: 64e6 }).toString();
      compare(JSON.parse(out), expected);
    });
  }
  it('R (tidyverse) code is generated with the same snapshot and series', () => {
    const { spec } = setup('measles', ['KEN'], { perCapita: true, rolling: 3 });
    const r = codeFor('r', spec);
    expect(r).toContain(spec.snapshot); expect(r).toContain(spec.items[0].seriesId); expect(r).toContain('stats::filter');
  });
  it.skipIf(!process.env.UO_RSCRIPT)('R (tidyverse): executed when R is available', () => {
    const { spec, expected } = setup('measles', ['KEN', 'ETH'], { perCapita: true, rolling: 3, excludeIncomplete: true });
    const dir = mkdtempSync(join(tmpdir(), 'uo-code-')); const file = join(dir, 'view.R');
    writeFileSync(file, codeFor('r', spec).replace('print(view)', 'cat(jsonlite::toJSON(unname(lapply(seq_len(nrow(view)), function(i) list(view$series_id[i], view$period[i], view$value[i]))), auto_unbox = TRUE, na = "null", digits = NA))'));
    compare(JSON.parse(execFileSync(process.env.UO_RSCRIPT!, [file], { maxBuffer: 64e6 }).toString()), expected);
  });
});

describe.skipIf(!hasData)('exports always carry provenance', () => {
  const core = hasData ? loadCoreFromDisk() : (null as any);
  const mk = () => { const skey = core.diseaseById.measles.default_skey; const other = core.diseaseById.measles.series.find((s: any) => s.source_id === 'owid').skey; const prov = seriesProv(core, 'Measles test view', [{ skey, iso3: 'KEN' }, { skey: other, iso3: 'KEN' }], null); const series: SeriesData[] = [{ id: 'a', label: 'WHO', p: ['2026-01-01'], v: [5], ptype: 'M', skey, iso3: 'KEN' }, { id: 'b', label: 'OWID', p: ['2024-01-01'], v: [7], ptype: 'Y', skey: other, iso3: 'KEN' }]; return { prov, series }; };
  it('bundles data, provenance sidecar, dictionary and citation; mixed sources keep per-row source columns', () => {
    const { prov, series } = mk();
    const rows = seriesRows(core, series, prov);
    expect(new Set(rows.map((r) => r.source_id))).toEqual(new Set(['who_measles_provisional', 'owid']));
    rows.forEach((r) => { expect(String(r.source_url)).toMatch(/^https:\/\//); expect(r.snapshot_id).toBe(core.manifest.snapshot_id); expect(String(r.record_id)).toContain('@'); });
    for (const fmt of ['csv', 'json'] as const) {
      const files = buildBundle(core, prov, rows, fmt, 'x');
      expect(files.map((f) => f.name)).toEqual([`x.${fmt}`, 'x.provenance.json', 'x.dictionary.json', 'CITATION.txt']);
      const p = JSON.parse(files[1].data);
      expect(p.sources.map((s: any) => s.source_id).sort()).toEqual(['owid', 'who_measles_provisional']);
      p.sources.forEach((s: any) => { expect(s.license).toBeTruthy(); expect(s.url).toBeTruthy(); expect(s.citation).toBeTruthy(); });
      expect(p.snapshot_id).toBe(core.manifest.snapshot_id); expect(p.suggested_citation).toContain('Snapshot'); expect(p.source_urls.length).toBeGreaterThan(0); expect(p.retrieval[0].retrieved_at).toBeTruthy(); expect(Array.isArray(p.transformations)).toBe(true);
      expect(files[3].data).toContain('License');
    }
    expect(JSON.parse(buildBundle(core, prov, rows, 'json', 'x')[0].data).provenance.snapshot_id).toBe(core.manifest.snapshot_id);
  });
  it('user-supplied rows are labelled and transforms are recorded', () => {
    const { prov } = mk();
    const rows = seriesRows(core, [{ id: 'u', label: 'mine', p: ['2026-01-01'], v: [1], ptype: 'M', userSupplied: true }], { ...prov, transforms: ['perCapita'] });
    expect(rows[0].origin_type).toBe('user-supplied'); expect(rows[0].source_id).toBe('user-supplied'); expect(rows[0].transforms).toBe('perCapita');
    expect(provBlock(core, { ...prov, transforms: ['perCapita'] }).transformations).toContainEqual({ op: 'view:perCapita', method_version: '1', params: {} });
  });
  it('images bake in title, source names, license, data-as-of and the short URL; captions cite the source', () => {
    const { prov } = mk();
    const svg = composeExportSVG({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 340"><rect/></svg>', width: 760, height: 340 }, imageMeta(core, prov, 'Measles in Kenya', 'Per 100,000 people'));
    for (const needle of ['Measles in Kenya', 'Per 100,000 people', 'WHO measles (provisional)', 'Our World in Data', 'License:', 'Data as of', 'understandingoutbreaks.pages.dev']) expect(svg).toContain(needle);
    const cap = caption(core, prov, 'Measles in Kenya');
    expect(cap).toContain('WHO measles (provisional)'); expect(cap).toContain('snapshot'); expect(cap).toMatch(/License/);
  });
  it('simulation images carry the watermark, engine and seed; captions say it is a simulation', () => {
    const prov = simProv('Simulated epidemic', null, { solver: 'rk45', seed: 7 });
    const meta = imageMeta(core, prov, 'Simulated epidemic');
    const svg = composeExportSVG({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>', width: 760, height: 340 }, meta);
    expect(svg).toContain('ILLUSTRATIVE SIMULATION'); expect(svg).toContain('NOT A FORECAST'); expect(svg).toContain('NOT FITTED TO DATA'); expect(svg).toMatch(/Engine \d+\.\d+\.\d+/); expect(svg).toContain('seed 7');
    const cap = caption(core, prov, 'Simulated epidemic');
    expect(cap).toMatch(/Illustrative simulation: not a forecast, not fitted to data/); expect(prov.origin).toBe('simulated'); expect(prov.sim?.engineVersion).toBeTruthy();
  });
  it('zip output is a valid archive', () => {
    const dir = mkdtempSync(join(tmpdir(), 'uo-zip-')); const f = join(dir, 'a.zip');
    writeFileSync(f, zip([{ name: 'a.csv', data: toCSV([{ a: 1, b: 'x,"y"' }]) }, { name: 'p.json', data: '{}' }]));
    const out = execFileSync(PY, ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(z.namelist(), z.read("a.csv").decode())', f]).toString();
    expect(out).toContain("['a.csv', 'p.json']"); expect(out).toContain('1,"x,""y"""');
  });
  it('comparability warnings fire when definitions or sources are mixed', () => {
    const d = core.diseaseById.measles; const a = d.default_skey; const b = d.series.find((s: any) => s.case_definition !== core.seriesByKey[a].case_definition).skey;
    const s = (skey: string): SeriesData => ({ id: skey, label: skey, p: ['2030-01-01'], v: [1], ptype: 'M', skey, incompleteFrom: '2029-01-01' });
    const r = comparabilityIssues([s(a), s(b)], core.seriesByKey);
    expect(r.defs.length).toBe(2); expect(r.incomplete).toBe(true);
    expect(comparabilityIssues([s(a)], core.seriesByKey).defs.length).toBe(1);
  });
});

describe('workbench logic', () => {
  const rows = [
    { iso3: 'KEN', year: '2025', value: 10, case_definition: 'confirmed', source_id: 'a', likely_incomplete: false, disease: 'measles' },
    { iso3: 'KEN', year: '2026', value: null, case_definition: 'confirmed', source_id: 'a', likely_incomplete: true, disease: 'measles' },
    { iso3: 'ETH', year: '2025', value: 5, case_definition: 'suspected', source_id: 'b', likely_incomplete: false, disease: 'measles' },
  ];
  it('safeguards flag mixed definitions, mixed sources and incomplete periods; grouping by them clears the warning', () => {
    expect(rowSafeguards(rows).map((g) => g.code).sort()).toEqual(['incomplete-included', 'mixed-definitions', 'mixed-sources']);
    expect(rowSafeguards(rows.slice(0, 1))).toEqual([]);
    expect(rowSafeguards(rows, ['case_definition', 'source_id']).map((g) => g.code)).toEqual(['incomplete-included']);
    expect(rowSafeguards([...rows, { ...rows[0], disease: 'polio' }]).map((g) => g.code)).toContain('cross-disease');
  });
  it('SQL safeguards: default builder queries are clean; unprotected SQL is flagged', () => {
    const base: QuerySpec = { dataset: 'timeseries', disease: 'measles', columns: ['iso3', 'value'], filters: [{ column: 'iso3', op: 'IN', value: 'KEN,ETH' }], groupBy: [], aggregate: null, comparableOnly: true, excludeIncomplete: true, snapshot: null, limit: 100 };
    const sql = buildSQL(base, 'https://x/data/v1');
    expect(sql).toContain("read_parquet('https://x/data/v1/bulk/timeseries/disease=measles/data.parquet')"); expect(sql).toContain('is_default_series'); expect(sql).toContain('NOT likely_incomplete'); expect(sql).toContain("iso3 IN ('KEN', 'ETH')");
    expect(sqlSafeguards(sql)).toEqual([]);
    const open = buildSQL({ ...base, comparableOnly: false, excludeIncomplete: false }, 'https://x/data/v1');
    expect(sqlSafeguards(open).map((g) => g.code).sort()).toEqual(['incomplete-included', 'mixed-definitions', 'mixed-sources']);
    expect(sqlSafeguards("SELECT * FROM read_parquet('a/disease=measles/data.parquet') t JOIN read_parquet('a/timeseries/disease=polio/data.parquet') u ON 1=1").map((g) => g.code)).toContain('cross-disease');
    expect(sqlSafeguards('SELECT 1')).toEqual([]);
    const pinned = buildSQL({ ...base, snapshot: '20261110T000000Z' }, 'https://x/data/v1');
    expect(pinned).toContain("snapshot_id <= '20261110T000000Z'"); expect(pinned).toContain('revisions.parquet');
    expect(buildSQL({ ...base, filters: [{ column: 'iso3', op: '=', value: "x'; DROP TABLE t; --" }] }, 'b')).toContain("'x''; DROP TABLE t; --'");
    expect(buildSQL({ ...base, groupBy: ['iso3'], aggregate: { fn: 'sum', column: 'value' } }, 'b')).toMatch(/SELECT iso3, sum\(value\) AS sum_value[\s\S]*GROUP BY iso3/);
  });
  it('pivot skips missing values and totals rows', () => {
    const p = pivot(rows, { rows: 'iso3', cols: 'year', value: 'value', fn: 'sum' });
    expect(p.rowKeys).toEqual(['ETH', 'KEN']); expect(p.cells.KEN['2025']).toBe(10); expect(p.cells.KEN['2026']).toBeUndefined(); expect(p.rowTotals.KEN).toBe(10);
    expect(pivot(rows, { rows: 'iso3', cols: null, value: 'value', fn: 'count' }).cells.KEN.value).toBe(2);
    expect(pivot(rows, { rows: 'year', cols: null, value: 'value', fn: 'mean' }).cells['2025'].value).toBe(7.5);
  });
  it('snapshot diff lists revised, new and removed values', () => {
    const ch = { k: { '2026-01-05': [[0, 10], [1, 12]], '2026-01-12': [[1, 4]], '2026-01-19': [[0, 3], [2, null]] } as any };
    const d = diffSnapshots(ch, 'KEN', 0, 2);
    expect(d.map((r) => [r.period, r.kind, r.change])).toEqual([['2026-01-05', 'revised', 2], ['2026-01-12', 'new', null], ['2026-01-19', 'removed', null]]);
    expect(d[0].series_id).toBe('k.KEN'); expect(diffSnapshots(ch, 'KEN', 1, 1)).toEqual([]);
  });
  it('aggregating places keeps a period only when every place reported', () => {
    const a = aggregateSeries([{ p: ['1', '2', '3'], v: [1, 2, null] }, { p: ['2', '3'], v: [10, 20] }]);
    expect(a.p).toEqual(['1', '2', '3']); expect(a.v).toEqual([null, 12, null]); expect(a.coverage).toEqual([1, 2, 1]);
  });
  it('custom overlay: parses CSV variants, validates columns and dates, never guesses ambiguous dates', () => {
    const csv = parseCSV('﻿date;school;cases\n2026-01-05;"North, A";3\n05/01/2026;B;4\n31/01/2026;B;5\nnot a date;B;6\n2026-02-01;B;abc\n');
    expect(csv.columns).toEqual(['date', 'school', 'cases']); expect(csv.rows[0][1]).toBe('North, A');
    expect(guessMapping(csv.columns)).toEqual({ place: 'school', date: 'date', value: 'cases' });
    const r = validateOverlay(csv, guessMapping(csv.columns));
    expect(r.points.map((p) => [p.place, p.date, p.value])).toEqual([['B', '2026-01-31', 5], ['North, A', '2026-01-05', 3]]);
    expect(r.skipped).toBe(3); expect(r.warnings).toEqual(['ambiguousDates', 'skippedRows']); expect(r.errors).toEqual([]);
    expect(validateOverlay(csv, { place: null, date: 'date', value: 'date' }).errors).toEqual(['sameColumn']);
    expect(validateOverlay(csv, { place: null, date: 'nope', value: 'cases' }).errors).toEqual(['noDate']);
    expect(validateOverlay({ columns: ['d', 'v'], rows: [['x', 'y']] }, { place: null, date: 'd', value: 'v' }).errors).toEqual(['noValidRows']);
    expect(validateOverlay({ columns: ['d', 'v'], rows: Array.from({ length: 50001 }, () => ['2026-01-01', '1']) }, { place: null, date: 'd', value: 'v' }).errors).toEqual(['tooManyRows']);
    expect(parseDate('2026-W02')).toBe('2026-01-05'); expect(parseDate('2026-02')).toBe('2026-02-01'); expect(parseDate('2026-02-30')).toBeNull(); expect(parseDate('03/04/2026')).toBeNull();
    expect(parseCSV('a,b\n1,"x\ny"\n').rows).toEqual([['1', 'x\ny']]);
  });
});

describe('pinned views and shareable state', () => {
  it('reconstructs exactly what was shown at an earlier snapshot (TEST DATA fixture)', async () => {
    const ts: TsFile = { disease: 'testdisease', iso3: 'KEN', snapshot_id: 'S3', series: { k: { p: ['2026-01-05', '2026-01-12', '2026-01-19'], v: [10, 25, 5] }, late: { p: ['2026-01-19'], v: [1] } } };
    const files: Record<string, any> = {
      'revisions/index.json': { snapshots: ['S1', 'S2', 'S3'], countries_with_changes: { testdisease: ['KEN'] }, base_exceptions: { 'late.KEN': 2 } },
      'revisions/testdisease/KEN.json': { changes: { k: { '2026-01-12': [[0, 20], [1, 25]], '2026-01-19': [[1, 5]], '2026-01-26': [[0, 7], [2, null]] } } },
    };
    vi.stubGlobal('fetch', async (url: string) => { const key = Object.keys(files).find((k) => String(url).endsWith(k)); return key ? { ok: true, json: async () => files[key] } : { ok: false, status: 404, json: async () => ({}) }; });
    const core = { manifest: { snapshot_id: 'S3' } } as any;
    const s1 = await reconstructAsOf(core, ts, 'S1');
    expect(s1.snapshot_id).toBe('S1'); expect(s1.series.k).toEqual({ p: ['2026-01-05', '2026-01-12', '2026-01-26'], v: [10, 20, 7] }); expect(s1.series.late).toBeUndefined();
    const s2 = await reconstructAsOf(core, ts, 'S2');
    expect(s2.series.k).toEqual({ p: ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'], v: [10, 25, 5, 7] });
    expect((await reconstructAsOf(core, ts, 'S3')).series.k).toEqual(ts.series.k);
    expect((await reconstructAsOf(core, ts, 'unknown')).series).toEqual(ts.series);
    vi.unstubAllGlobals();
  });
  it('URLs carry locale, mode, snapshot and view state', () => {
    const r = parseRoute({ pathname: '/es/place/KEN', search: '?mode=analyst&snapshot=S1&d=measles&tf_place-main=pc.r3' });
    expect([r.locale, r.parts, r.mode, r.snapshot]).toEqual(['es', ['place', 'KEN'], 'analyst', 'S1']);
    expect(href(r, 'outbreaks')).toBe('/es/outbreaks?mode=analyst&snapshot=S1');
    expect(href(r, 'place/KEN', { snapshot: null }, { keepAll: true })).toBe('/es/place/KEN?mode=analyst&d=measles&tf_place-main=pc.r3');
    expect(parseRoute({ pathname: '/embed/fr/chart', search: '?d=mpox' })).toMatchObject({ embed: true, locale: 'fr', parts: ['chart'], mode: 'simple' });
    expect(parseRoute({ pathname: '/place/KEN', search: '' }).locale).toBe('en');
  });
  it('watchlists round-trip through URL and file, and reject foreign files', () => {
    const items = [{ kind: 'place' as const, iso3: 'KEN', disease: 'measles' }, { kind: 'disease' as const, disease: 'polio' }, { kind: 'event' as const, event: 'ebola-cod-202605-69a17d' }];
    expect(decodeWatch(encodeWatch(items))).toEqual(items);
    expect(decodeWatch('p:<script>,x:1,d:Bad Id')).toEqual([]);
    expect(parseWatchFile(JSON.stringify({ format: 'understandingoutbreaks-watchlist', version: 1, items }))).toEqual(items);
    expect(() => parseWatchFile('{"items": []}')).toThrow();
  });
});

describe.skipIf(!hasData)('trace panels render for every visualization type', () => {
  const core = hasData ? loadCoreFromDisk() : (null as any);
  const route = parseRoute({ pathname: '/en/', search: '?mode=analyst' });
  const mount = (prov: Prov) => { const el = document.createElement('div'); document.body.appendChild(el); render(h(AppCtx.Provider, { value: { core, route } }, h(SourceChip, { prov })), el); return el; };
  const provs: [string, Prov][] = hasData ? [
    ['chart / table (source-reported series)', seriesProv(core, 'Chart', [{ skey: core.diseaseById.measles.default_skey, iso3: 'KEN' }], null)],
    ['map layer (site-derived)', { title: 'Map', origin: 'site-derived', sourceIds: ['who_measles_provisional', 'worldbank', 'naturalearth'], asOf: '2026-11-10', snapshotId: 'S', series: [{ skey: core.diseaseById.measles.default_skey }], method: { name: 'window_rate', version: '1' } }],
    ['event page / summary', { title: 'Event', origin: 'site-derived', sourceIds: ['who_don', 'geonames'], asOf: '2026-11-06', snapshotId: 'S', method: { name: 'group_by_disease_place_gap', version: '1' }, links: [{ label: 'notice', url: 'https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON625', sourceId: 'who_don', external: true }] }],
    ['signal flag', { title: 'Flag', origin: 'site-derived', sourceIds: ['who_flunet'], asOf: '2026-11-10', snapshotId: 'S', method: { name: 'rolling_baseline_c2', version: '1' } }],
    ['ranking', { title: 'Ranking', origin: 'site-derived', sourceIds: ['who_don', 'cdc_travel'], asOf: null, snapshotId: 'S', method: { name: 'active_rank', version: '1' } }],
    ['statistic / quality', { title: 'Quality', origin: 'site-derived', sourceIds: ['uo_site'], asOf: null, snapshotId: 'S', method: { name: 'quality_metrics', version: '1' } }],
    ['simulation', simProv('Sim', null, { solver: 'rk45' })],
    ['user overlay', { title: 'Mine', origin: 'user-supplied', sourceIds: [], asOf: null, snapshotId: 'S' }],
  ] : [];
  for (const [name, prov] of provs) {
    it(name, async () => {
      const el = mount(prov);
      const chip = el.querySelector('[data-testid="source-chip"]') as HTMLButtonElement;
      expect(chip).toBeTruthy(); expect(chip.dataset.origin).toBe(prov.origin); expect(chip.textContent).toContain(t('origin.' + prov.origin));
      for (const s of prov.sourceIds.slice(0, 2)) expect(chip.textContent).toContain(core.sources[s].short_name);
      chip.click(); await new Promise((r) => setTimeout(r, 20));
      const panel = document.querySelector('[role="dialog"]') as HTMLElement;
      expect(panel).toBeTruthy(); expect(panel.textContent).toContain(t('trace.title')); expect(panel.textContent).toContain(t('origin.' + prov.origin + '.explain'));
      for (const s of prov.sourceIds) { expect(panel.textContent).toContain(core.sources[s].name); expect(panel.textContent).toContain(core.sources[s].license); }
      if (prov.sourceIds.length) expect(panel.querySelectorAll('a[href^="http"], a[href^="/"]').length).toBeGreaterThan(0);
      expect(panel.textContent).toContain(prov.snapshotId);
      (panel.querySelector('button') as HTMLButtonElement).click(); await new Promise((r) => setTimeout(r, 10)); el.remove();
    });
  }
});

describe('simulation boundaries are enforced in code', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
  const sim = walk(join(ROOT, 'src', 'sim'));
  it('the engine and worker never touch the reported-data layer or the network', () => {
    for (const f of sim.filter((x) => /sim\/(engine|worker)/.test(x))) {
      const s = readFileSync(f, 'utf8');
      expect(s, f).not.toMatch(/from ['"][^'"]*lib\/(data|app|series|prov)['"]/); expect(s, f).not.toMatch(/\bfetch\(|XMLHttpRequest|localStorage|new Function|\beval\(/);
    }
  });
  it('no fitting, calibration, estimation-from-data, nowcasting or forecasting functions exist', () => {
    for (const f of sim) {
      const names = Array.from(readFileSync(f, 'utf8').matchAll(/export (?:async )?(?:function|const) ([A-Za-z0-9_]+)/g)).map((m) => m[1]);
      for (const n of names) expect(n, f).not.toMatch(/fit|calibrat|nowcast|forecast|infer|estimateR|projectTo/i);
    }
    const en = JSON.parse(readFileSync(join(ROOT, 'src', 'i18n', 'locales', 'en.json'), 'utf8'));
    for (const [k, v] of Object.entries<string>(en)) if (/^(action|sim|tool|obs|ens|sweep|net|meta|build)\./.test(k)) expect(v, k).not.toMatch(/\b(fit the model|calibrate|estimate R|nowcast|forecast for|predict the)\b/i);
  });
  it('only the optional shape comparison reads reported data, and it never feeds the model', () => {
    const readers = sim.filter((f) => /lib\/data['"]/.test(readFileSync(f, 'utf8'))).map((f) => f.split('/src/')[1]);
    expect(readers).toEqual(['sim/ui/Sandbox.tsx']);
    const src = readFileSync(join(ROOT, 'src', 'sim', 'ui', 'Sandbox.tsx'), 'utf8');
    const shape = src.slice(src.indexOf('function ShapeComparison'));
    expect(shape).not.toMatch(/buildModel|setO\(|set\(\{|specFromParam|useRun/); expect(shape).toContain("t('shape.notice')"); expect(shape).toMatch(/new Date\(\)\.getUTCFullYear\(\) - 2/);
    expect(src).not.toMatch(/initial:\s*[^,}]*(ts\.|raw\.|reported)/);
  });
  it('specs cannot carry calendar dates for real places, and time is relative', () => {
    const model = readFileSync(join(ROOT, 'src', 'sim', 'engine', 'model.ts'), 'utf8');
    expect(model).toContain('unknown field'); expect(model).toContain('inventedStart');
    const en = JSON.parse(readFileSync(join(ROOT, 'src', 'i18n', 'locales', 'en.json'), 'utf8'));
    expect(en['sim.dayAxis']).toMatch(/relative/i); expect(en['sim.banner']).toMatch(/not a forecast, not fitted to data/i);
    for (const k of ['setting.town', 'setting.school', 'setting.city']) expect(en[k]).toMatch(/^A (town|school|city) of [\d,]+ people$/);
  });
  it('every simulation view, export and embed shows the banner or watermark', () => {
    const common = readFileSync(join(ROOT, 'src', 'sim', 'ui', 'common.tsx'), 'utf8');
    expect(common).toMatch(/<Chart [^>]*simulated/); expect(common).toContain("t('sim.simulated')"); expect(common).toContain("disclaimer: t('sim.banner')"); expect(common).toContain('ILLUSTRATIVE'.length ? "origin: 'simulated'" : '');
    const index = readFileSync(join(ROOT, 'src', 'sim', 'ui', 'index.tsx'), 'utf8');
    expect(index).toMatch(/tool !== 'basic' && <SimBanner \/>/);
    expect(readFileSync(join(ROOT, 'src', 'sim', 'ui', 'Sandbox.tsx'), 'utf8')).toMatch(/<SimBanner \/>/);
    expect(readFileSync(join(ROOT, 'src', 'embed', 'main.tsx'), 'utf8')).toMatch(/prov\?\.origin === 'simulated' && <div class="notice sim"/);
    const chart = readFileSync(join(ROOT, 'src', 'components', 'Chart.tsx'), 'utf8');
    expect(chart).toContain("t('sim.watermarkShort')"); expect(chart).toMatch(/simulated \|\| d\.s\.dashed \? '7 4'/);
    // every chart drawn inside the sandbox goes through SimChartCard or passes `simulated`
    for (const f of sim.filter((x) => /sim\/ui\//.test(x))) { const s = readFileSync(f, 'utf8'); for (const m of s.matchAll(/<Chart\b[^>]*>/g)) if (!/ShapeComparison|reported/.test(s.slice(Math.max(0, m.index! - 300), m.index!))) expect(m[0], f).toMatch(/simulated/); }
  });
  it('presets carry citations with a verification status, and none invents a range', () => {
    expect(PRESETS.length).toBeGreaterThan(0);
    for (const p of PRESETS) {
      expect(p.source_id).toBe('literature'); expect(p.origin_type).toBe('simulated'); expect(p.citations.length).toBeGreaterThan(0);
      for (const c of p.citations) { expect(c.text.length).toBeGreaterThan(20); expect(c.verified === null || /^\d{4}-\d{2}-\d{2}$/.test(c.verified)).toBe(true); }
      if (p.r0Range) { expect(p.citations.some((c) => c.verified && c.doi)).toBe(true); expect(p.citations.map((c) => c.text).join(' ')).toMatch(new RegExp(`${p.r0Range[0]}[–-]${p.r0Range[1]}`)); }
      else expect(p.unverified).toContain('R0');
    }
    for (const c of METHOD_REFERENCES) expect(c.doi || c.url).toBeTruthy();
  });
});

describe('positioning and neutral wording', () => {
  const en = JSON.parse(readFileSync(join(ROOT, 'src', 'i18n', 'locales', 'en.json'), 'utf8')) as Record<string, string>;
  it('states plainly what the site is not, in the footer, About and methodology', () => {
    for (const k of ['footer.positioning', 'about.not.p1', 'methodology.scope.p1']) { expect(en[k]).toMatch(/not a surveillance system|does not run surveillance/i); expect(en[k]).toMatch(/medical advice/i); }
    expect(en['footer.positioning']).toMatch(/not an early-warning service, not a forecasting service/);
  });
  it('signal flags and rankings use neutral language', () => {
    for (const [k, v] of Object.entries(en)) if (/^(flags|flagstatus|rank|status|overview|changes|event|outbreak)\./.test(k)) expect(v, k).not.toMatch(/\b(surge|outbreak detected|severe|dangerous|alarming)\b/i);
    expect(en['flags.text']).toBe('Reported counts are unusually high compared with this place’s recent baseline (method {method}).');
    expect(en['flags.neutral']).toMatch(/not alerts/); expect(en['status.no_recent_update.explain']).toMatch(/not a judgment/);
  });
});
