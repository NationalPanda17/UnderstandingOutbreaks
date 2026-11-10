/** SQL console (DuckDB-WASM, single-threaded build: no cross-origin isolation headers needed).
 *  The runtime is self-hosted, loaded only when the user asks, and reads only the byte ranges it needs from the Parquet files. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { SITE, setParams } from '../lib/app';
import { getJSON } from '../lib/data';
import { download, slugify, toCSV, zip } from '../lib/exporters';
import { num, t } from '../lib/i18n';
import { provBlock, type Prov } from '../lib/prov';
import { diseaseName } from '../components/Layout';
import { SourceChip, useApp } from '../components/SourceChip';
import { buildSQL, datasetPath, sqlSafeguards, type Cell, type QuerySpec, type Safeguard } from './logic';

let dbPromise: Promise<any> | null = null;

async function fetchWithProgress(url: string, onProgress: (done: number, total: number) => void): Promise<Blob> {
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok || !r.body) throw new Error(`${r.status} ${url}`);
  const total = Number(r.headers.get('content-length') ?? 0);
  const reader = r.body.getReader(); const chunks: BlobPart[] = []; let done = 0;
  for (;;) { const { value, done: fin } = await reader.read(); if (fin) break; chunks.push(value as BlobPart); done += value.length; onProgress(done, total); }
  return new Blob(chunks, { type: r.headers.get('content-type') ?? 'application/octet-stream' });
}

export function loadDuckDB(onProgress: (done: number, total: number) => void): Promise<any> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const base = SITE.toolAssetsBaseUrl + '/duckdb';
      const [duckdb, wasm, workerSrc] = await Promise.all([import('@duckdb/duckdb-wasm'), fetchWithProgress(`${base}/duckdb-eh.wasm`, onProgress), fetch(`${base}/duckdb-browser-eh.worker.js`, { credentials: 'omit' }).then((r) => { if (!r.ok) throw new Error('worker ' + r.status); return r.text(); })]);
      const worker = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
      const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      await db.instantiate(URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' })));
      const conn = await db.connect();
      return { db, conn };
    })();
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function toRows(result: any): { columns: string[]; rows: Record<string, Cell>[] } {
  const columns: string[] = result.schema.fields.map((f: any) => f.name);
  const dateCols = new Set<string>(result.schema.fields.filter((f: any) => /^Date/.test(String(f.type))).map((f: any) => f.name));
  const rows = result.toArray().map((r: any) => {
    const o: Record<string, Cell> = {};
    for (const c of columns) { let v = r[c]; if (typeof v === 'bigint') v = Number(v);
      if (dateCols.has(c) && typeof v === 'number') v = new Date(v).toISOString().slice(0, 10); else if (v instanceof Date) v = v.toISOString().slice(0, 10); else if (v !== null && typeof v === 'object') v = String(v); o[c] = v as Cell; }
    return o;
  });
  return { columns, rows };
}

const TS_COLUMNS = ['iso3', 'place_name', 'period_start', 'period_type', 'metric', 'value', 'rate_per_100k', 'case_definition', 'surveillance_system', 'origin_type', 'likely_incomplete', 'is_default_series', 'source_id', 'source_url', 'snapshot_id', 'license', 'record_id'];

export function Sql() {
  const { core, route } = useApp();
  const base = window.location.origin + SITE.dataPath;
  const tsDiseases = core.diseases.filter((d) => d.has_timeseries);
  const [spec, setSpec] = useState<QuerySpec>({ dataset: 'timeseries', disease: 'measles', columns: ['iso3', 'place_name', 'period_start', 'value', 'rate_per_100k', 'case_definition', 'source_id'], filters: [{ column: 'iso3', op: 'IN', value: 'KEN,ETH' }], groupBy: [], aggregate: null, comparableOnly: true, excludeIncomplete: true, snapshot: route.snapshot, limit: 500 });
  const [sql, setSql] = useState(() => route.params.get('q') ?? buildSQL(spec, base));
  const [fromBuilder, setFromBuilder] = useState(!route.params.get('q'));
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'running' | 'error'>('idle');
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ columns: string[]; rows: Record<string, Cell>[]; ms: number; sql: string } | null>(null);
  const [dict, setDict] = useState<Record<string, { name: string; type: string; description: string }[]>>({});
  const [toolSize, setToolSize] = useState<number | null>(null);
  const small = typeof window !== 'undefined' && window.innerWidth < 720;
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { getJSON<any>('catalog/dictionary.json').then((d) => setDict(d.tables)).catch(() => undefined); fetch(SITE.toolAssetsBaseUrl + '/manifest.json').then((r) => r.json()).then((m) => setToolSize(Object.values(m.tools.duckdb.files as Record<string, number>).reduce((a, b) => a + b, 0))).catch(() => setToolSize(null)); }, []);
  const update = (patch: Partial<QuerySpec>) => { const next = { ...spec, ...patch }; setSpec(next); setSql(buildSQL(next, base)); setFromBuilder(true); };
  const guards: Safeguard[] = useMemo(() => sqlSafeguards(sql), [sql]);
  const columnsFor = (ds: string) => (dict[ds] ?? []).map((c) => c.name);

  const run = async () => {
    setError('');
    try {
      if (state === 'idle' || state === 'error') setState('loading');
      const { conn } = await loadDuckDB((d, tot) => setProgress([d, tot]));
      setState('running');
      const t0 = performance.now();
      const res = await conn.query(sql);
      setResult({ ...toRows(res), ms: performance.now() - t0, sql });
      setState('ready');
    } catch (e: any) { setError(String(e?.message ?? e)); setState('error'); }
  };

  const usedDiseases = Array.from(new Set(Array.from(sql.matchAll(/disease=([a-z0-9_]+)/g)).map((m) => m[1])));
  const sourceIds = Array.from(new Set(usedDiseases.flatMap((d) => (core.manifest.bulk.timeseries.find((b: any) => b.disease === d)?.source_ids ?? []) as string[]).concat(/events\.parquet/.test(sql) ? ['who_don', 'cdc_travel', 'geonames'] : [], /flags\.parquet|revisions/.test(sql) ? ['uo_site'] : [])));
  const prov: Prov = { title: t('sql.resultTitle'), origin: 'site-derived', sourceIds: sourceIds.length ? sourceIds : ['uo_site'], asOf: core.manifest.generated_at.slice(0, 10), snapshotId: spec.snapshot ?? core.manifest.snapshot_id, method: { name: 'user_sql_query', version: '1', params: { sql: result?.sql ?? sql } } };
  const exportResult = async (fmt: 'csv' | 'json' | 'parquet') => {
    if (!result) return;
    const block = { ...provBlock(core, prov), filters_and_transforms: result.sql, safeguards: guards.map((g) => g.code) };
    const name = slugify('sql-result');
    const side = { name: `${name}.provenance.json`, data: JSON.stringify(block, null, 2) };
    if (fmt === 'csv') download(`${name}.zip`, zip([{ name: `${name}.csv`, data: toCSV(result.rows, result.columns) }, side]), 'application/zip');
    else if (fmt === 'json') download(`${name}.zip`, zip([{ name: `${name}.json`, data: JSON.stringify({ provenance: block, data: result.rows }, null, 1) }, side]), 'application/zip');
    else {
      const { db, conn } = await loadDuckDB(() => undefined);
      await conn.query(`COPY (${result.sql.trim().replace(/;\s*$/, '')}) TO 'uo_out.parquet' (FORMAT PARQUET)`);
      const buf: Uint8Array = await db.copyFileToBuffer('uo_out.parquet');
      download(`${name}.zip`, zip([{ name: `${name}.parquet`, data: buf }, side]), 'application/zip');
    }
  };

  const samples: { key: string; sql: string }[] = [
    { key: 'sample.topRates', sql: buildSQL({ ...spec, dataset: 'timeseries', disease: 'measles', columns: [], filters: [{ column: 'period_start', op: '>=', value: '2025-01-01' }], groupBy: ['place_name'], aggregate: { fn: 'sum', column: 'rate_per_100k' }, comparableOnly: true, excludeIncomplete: true, snapshot: null, limit: 20 }, base).replace('ORDER BY place_name', 'ORDER BY 2 DESC') },
    { key: 'sample.series', sql: buildSQL({ ...spec, dataset: 'timeseries', disease: 'covid19', columns: ['iso3', 'period_start', 'value', 'rate_per_100k', 'source_id', 'source_url'], filters: [{ column: 'iso3', op: '=', value: 'BRA' }, { column: 'metric', op: '=', value: 'cases' }], groupBy: [], aggregate: null, comparableOnly: true, excludeIncomplete: true, snapshot: null, limit: 500 }, base) },
    { key: 'sample.revised', sql: `SELECT series_id, period, count(*) AS versions, min(value) AS lowest, max(value) AS highest\nFROM read_parquet('${datasetPath(base, 'revisions', 'covid19')}')\nGROUP BY series_id, period\nHAVING count(*) > 1\nORDER BY versions DESC\nLIMIT 100;` },
    { key: 'sample.events', sql: `SELECT disease, count(DISTINCT event_id) AS events, max(last_report) AS latest_notice\nFROM read_parquet('${datasetPath(base, 'events', '*')}')\nGROUP BY disease\nORDER BY events DESC\nLIMIT 50;` },
    { key: 'sample.flags', sql: `SELECT disease, iso3, period, value, threshold, method, method_version\nFROM read_parquet('${datasetPath(base, 'flags', '*')}')\nWHERE status = 'flagged'\nORDER BY period DESC\nLIMIT 100;` },
  ];

  return (
    <>
      <h2>{t('sql.title')}</h2>
      <p class="muted">{t('sql.lead')}</p>
      {small && <div class="notice warn" role="note" data-testid="small-screen">{t('workbench.smallScreen')}</div>}
      <div class="grid side">
        <section class="card" aria-label={t('sql.builder')}>
          <h3>{t('sql.builder')}</h3>
          <p class="sub">{t('sql.builderHint')}</p>
          <div class="tools">
            <label>{t('sql.dataset')} <select value={spec.dataset} onChange={(e) => { const ds = (e.target as HTMLSelectElement).value as QuerySpec['dataset']; update({ dataset: ds, columns: [], filters: [], groupBy: [], aggregate: null }); }}>
              {(['timeseries', 'events', 'flags', 'revisions'] as const).map((d) => <option key={d} value={d}>{t('sql.ds.' + d)}</option>)}</select></label>
            {(spec.dataset === 'timeseries' || spec.dataset === 'revisions') && <label>{t('filter.disease')} <select value={spec.disease} onChange={(e) => update({ disease: (e.target as HTMLSelectElement).value })}>{tsDiseases.map((d) => <option key={d.id} value={d.id}>{diseaseName(core, d.id)}</option>)}</select></label>}
            {spec.dataset === 'timeseries' && <label>{t('pin.pick')} <select value={spec.snapshot ?? ''} onChange={(e) => update({ snapshot: (e.target as HTMLSelectElement).value || null })}><option value="">{t('sql.latest')}</option>{core.manifest.snapshots.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}</select></label>}
          </div>
          <fieldset><legend>{t('sql.columns')}</legend>
            {(spec.dataset === 'timeseries' ? TS_COLUMNS : columnsFor(spec.dataset)).map((c) => <label key={c} style={{ marginInlineEnd: '10px', display: 'inline-block' }} title={(dict[spec.dataset] ?? []).find((x) => x.name === c)?.description}><input type="checkbox" checked={spec.columns.includes(c)} onChange={() => update({ columns: spec.columns.includes(c) ? spec.columns.filter((x) => x !== c) : [...spec.columns, c] })} /> <code>{c}</code></label>)}
          </fieldset>
          <fieldset><legend>{t('sql.filters')}</legend>
            {spec.filters.map((f, i) => (
              <div class="tools" key={i}>
                <select aria-label={t('sql.filterColumn')} value={f.column} onChange={(e) => update({ filters: spec.filters.map((x, j) => (j === i ? { ...x, column: (e.target as HTMLSelectElement).value } : x)) })}>{columnsFor(spec.dataset).map((c) => <option key={c} value={c}>{c}</option>)}</select>
                <select aria-label={t('sql.filterOp')} value={f.op} onChange={(e) => update({ filters: spec.filters.map((x, j) => (j === i ? { ...x, op: (e.target as HTMLSelectElement).value as any } : x)) })}>{['=', '!=', '>', '>=', '<', '<=', 'LIKE', 'IN'].map((o) => <option key={o} value={o}>{o}</option>)}</select>
                <input type="text" aria-label={t('sql.filterValue')} value={f.value} onInput={(e) => update({ filters: spec.filters.map((x, j) => (j === i ? { ...x, value: (e.target as HTMLInputElement).value } : x)) })} />
                <button type="button" class="btn small" onClick={() => update({ filters: spec.filters.filter((_, j) => j !== i) })} aria-label={t('sql.removeFilter')}>×</button>
              </div>
            ))}
            <button type="button" class="btn small" onClick={() => update({ filters: [...spec.filters, { column: columnsFor(spec.dataset)[0] ?? 'iso3', op: '=', value: '' }] })}>{t('sql.addFilter')}</button>
          </fieldset>
          <div class="tools">
            <label>{t('sql.groupBy')} <select value={spec.groupBy[0] ?? ''} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; update({ groupBy: v ? [v] : [], aggregate: v ? spec.aggregate ?? { fn: 'sum', column: spec.dataset === 'timeseries' ? 'value' : columnsFor(spec.dataset)[0] } : null }); }}><option value="">{t('sql.noGroup')}</option>{columnsFor(spec.dataset).map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            {spec.aggregate && <>
              <label>{t('sql.aggregate')} <select value={spec.aggregate.fn} onChange={(e) => update({ aggregate: { ...spec.aggregate!, fn: (e.target as HTMLSelectElement).value as any } })}>{['sum', 'avg', 'max', 'min', 'count'].map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
              <select aria-label={t('sql.aggColumn')} value={spec.aggregate.column} onChange={(e) => update({ aggregate: { ...spec.aggregate!, column: (e.target as HTMLSelectElement).value } })}>{columnsFor(spec.dataset).map((c) => <option key={c} value={c}>{c}</option>)}</select>
            </>}
          </div>
          {spec.dataset === 'timeseries' && <div class="tools">
            <label><input type="checkbox" checked={spec.comparableOnly} onChange={(e) => update({ comparableOnly: (e.target as HTMLInputElement).checked })} /> {t('sql.comparable')}</label>
            <label><input type="checkbox" checked={spec.excludeIncomplete} onChange={(e) => update({ excludeIncomplete: (e.target as HTMLInputElement).checked })} /> {t('transform.excludeIncomplete')}</label>
          </div>}
        </section>
        <section class="card">
          <h3>{t('sql.samples')}</h3>
          <ul class="list small">{samples.map((s) => <li key={s.key}><button type="button" class="btn small" onClick={() => { setSql(s.sql); setFromBuilder(false); }}>{t(s.key)}</button></li>)}</ul>
          <h3>{t('sql.schema')}</h3>
          {Object.entries(dict).map(([tbl, cols]) => <details class="more" key={tbl}><summary><code>{tbl}</code> ({cols.length})</summary><ul class="list small">{cols.map((c) => <li key={c.name} title={c.description}><code>{c.name}</code> <span class="muted">{c.type}</span><div class="muted">{c.description}</div></li>)}</ul></details>)}
        </section>
      </div>

      <section class="card" style={{ marginTop: '16px' }}>
        <h3><label for="sql-editor">{t('sql.editor')}</label></h3>
        <textarea id="sql-editor" ref={ta} value={sql} rows={12} spellcheck={false} style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: '.85rem' }} onInput={(e) => { setSql((e.target as HTMLTextAreaElement).value); setFromBuilder(false); }}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } }} aria-describedby="sql-help" />
        <p id="sql-help" class="small muted">{t('sql.help')}</p>
        {guards.length > 0 && (
          <div class="notice warn" role="note" data-testid="sql-safeguards">
            {guards.map((g) => <div key={g.code}>{t('guard.' + g.code, { detail: g.detail.join(', ') })}</div>)}
            {fromBuilder && spec.dataset === 'timeseries' && <button type="button" class="btn small" onClick={() => update({ comparableOnly: true, excludeIncomplete: true })}>{t('warn.restrict')}</button>}
          </div>
        )}
        <div class="btnrow">
          <button type="button" class="btn primary" onClick={run} disabled={state === 'loading' || state === 'running'} data-testid="sql-run">{state === 'idle' ? t('sql.loadAndRun', { size: toolSize ? num(toolSize / 1048576, { maximumFractionDigits: 0 }) : '36' }) : t('sql.run')}</button>
          <button type="button" class="btn" onClick={() => setParams({ q: sql })}>{t('sql.share')}</button>
          {state === 'loading' && <span role="status" class="small">{t('sql.downloading', { done: num(progress[0] / 1048576, { maximumFractionDigits: 1 }), total: num(progress[1] / 1048576, { maximumFractionDigits: 1 }) })}</span>}
          {state === 'running' && <span role="status" class="small">{t('sql.running')}</span>}
        </div>
        {state === 'loading' && <div class="progress" aria-hidden="true"><i style={{ width: progress[1] ? `${(100 * progress[0]) / progress[1]}%` : '5%' }} /></div>}
        {error && <div class="notice warn" role="alert"><b>{t('sql.error')}</b> <code class="small">{error}</code></div>}
      </section>

      {result && (
        <section class="card" style={{ marginTop: '16px' }} aria-live="polite">
          <header><h3>{t('sql.result', { n: result.rows.length, ms: num(result.ms, { maximumFractionDigits: 0 }) })}</h3><SourceChip prov={prov} /></header>
          <div class="tablewrap" tabIndex={0} role="region" aria-label={t('sql.resultTitle')}>
            <table class="data"><caption class="sr">{t('sql.resultTitle')}</caption>
              <thead><tr>{result.columns.map((c) => <th scope="col" key={c}>{c}</th>)}</tr></thead>
              <tbody>{result.rows.slice(0, 500).map((r, i) => <tr key={i}>{result.columns.map((c) => <td key={c} class={typeof r[c] === 'number' ? 'n' : undefined}>{r[c] === null ? <span class="muted">∅</span> : typeof r[c] === 'number' ? num(r[c] as number, { maximumFractionDigits: 4 }) : String(r[c])}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {result.rows.length > 500 && <p class="small muted">{t('table.truncated', { n: 500, total: result.rows.length })}</p>}
          <div class="btnrow" style={{ marginTop: '8px' }}>
            <button type="button" class="btn small" onClick={() => exportResult('csv')}>{t('action.downloadCsv')}</button>
            <button type="button" class="btn small" onClick={() => exportResult('json')}>{t('action.downloadJson')}</button>
            <button type="button" class="btn small" onClick={() => exportResult('parquet')}>Parquet</button>
          </div>
          <p class="small muted">{t('sql.exportNote')}</p>
        </section>
      )}
    </>
  );
}
