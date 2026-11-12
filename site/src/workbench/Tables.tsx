/** Pivot / table explorer and chart builder. Both work on one disease's published bulk file, loaded on demand. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { SITE } from '../lib/app';
import { caption, composeExportSVG, download, exportBundle, imageMeta, slugify, svgToPngBlob, zip } from '../lib/exporters';
import { num, smart, t } from '../lib/i18n';
import { provBlock, type Prov } from '../lib/prov';
import { Chart } from '../components/Chart';
import { ErrorBox, Loading, diseaseName, useAsync } from '../components/Layout';
import { SourceChip, useApp } from '../components/SourceChip';
import type { SeriesData } from '../lib/transforms';
import { fetchCsvGz, pivot, rowSafeguards, type Cell } from './logic';

type Row = Record<string, Cell>;
const NUMERIC = new Set(['value', 'population', 'rate_per_100k']);
const BOOL = new Set(['likely_incomplete', 'is_default_series']);

export function useBulk(disease: string) {
  const { core } = useApp();
  return useAsync(async () => {
    const csv = await fetchCsvGz(`${SITE.dataPath}/bulk/timeseries/disease=${disease}/data.csv.gz`);
    const rows: Row[] = csv.rows.map((r) => {
      const o: Row = {};
      csv.columns.forEach((c, i) => { const v = r[i]; o[c] = NUMERIC.has(c) ? (v === '' ? null : Number(v)) : BOOL.has(c) ? v === 'True' || v === 'true' : v; });
      o.year = String(o.period_start).slice(0, 4);
      o.region = core.places[String(o.iso3)]?.region ?? '';
      return o;
    });
    return rows;
  }, [disease]);
}

function Guards({ rows, groupCols, onRestrict }: { rows: Row[]; groupCols: string[]; onRestrict: () => void }) {
  const g = rowSafeguards(rows, groupCols);
  if (!g.length) return null;
  return (
    <div class="notice warn" role="note" data-testid="tool-safeguards">
      {g.map((x) => <div key={x.code}>{t('guard.' + x.code, { detail: x.detail.map((d) => (x.code === 'mixed-definitions' ? t('def.' + d) : d)).join(', ') })}</div>)}
      <button type="button" class="btn small" onClick={onRestrict}>{t('warn.restrict')}</button>
    </div>
  );
}

function useFilters() {
  const [comparable, setComparable] = useState(true);
  const [complete, setComplete] = useState(true);
  const [metric, setMetric] = useState('');
  const apply = (rows: Row[]) => rows.filter((r) => (!comparable || r.is_default_series) && (!complete || !r.likely_incomplete) && (!metric || r.metric === metric));
  const ui = (rows: Row[]) => (
    <div class="tools">
      <label><input type="checkbox" checked={comparable} onChange={(e) => setComparable((e.target as HTMLInputElement).checked)} /> {t('sql.comparable')}</label>
      <label><input type="checkbox" checked={complete} onChange={(e) => setComplete((e.target as HTMLInputElement).checked)} /> {t('transform.excludeIncomplete')}</label>
      <label>{t('filter.metric')} <select value={metric} onChange={(e) => setMetric((e.target as HTMLSelectElement).value)}><option value="">{t('filter.any')}</option>{Array.from(new Set(rows.map((r) => String(r.metric)))).map((m) => <option key={m} value={m}>{t('metric.' + m)}</option>)}</select></label>
    </div>
  );
  return { apply, ui, restrict: () => { setComparable(true); setComplete(true); } };
}

function bulkProv(core: any, disease: string, title: string, method: string, params: Record<string, unknown>): Prov {
  const b = core.manifest.bulk.timeseries.find((x: any) => x.disease === disease);
  return { title, origin: 'site-derived', sourceIds: b?.source_ids ?? ['uo_site'], asOf: core.manifest.generated_at.slice(0, 10), snapshotId: core.manifest.snapshot_id, method: { name: method, version: '1', params } };
}

export function Pivot() {
  const { core } = useApp();
  const tsDiseases = core.diseases.filter((d: any) => d.has_timeseries);
  const [disease, setDisease] = useState('measles');
  const bulk = useBulk(disease);
  const f = useFilters();
  const [rowsBy, setRowsBy] = useState('place_name');
  const [colsBy, setColsBy] = useState<string>('year');
  const [value, setValue] = useState('value');
  const [fn, setFn] = useState<'sum' | 'mean' | 'max' | 'count'>('sum');
  const [sortCol, setSortCol] = useState<string>('__total');
  const [sel, setSel] = useState<string | null>(null);
  const dims = ['place_name', 'iso3', 'region', 'year', 'period_start', 'metric', 'case_definition', 'surveillance_system', 'source_id', 'origin_type', 'period_type'];
  const filtered = useMemo(() => f.apply(bulk.data ?? []), [bulk.data, f]);
  const pv = useMemo(() => pivot(filtered, { rows: rowsBy, cols: colsBy || null, value, fn }), [filtered, rowsBy, colsBy, value, fn]);
  const sortedRows = useMemo(() => pv.rowKeys.slice().sort((a, b) => { const va = sortCol === '__total' ? pv.rowTotals[a] : sortCol === '__key' ? null : pv.cells[a][sortCol]; const vb = sortCol === '__total' ? pv.rowTotals[b] : sortCol === '__key' ? null : pv.cells[b][sortCol]; return sortCol === '__key' ? a.localeCompare(b) : (vb ?? -Infinity) - (va ?? -Infinity); }), [pv, sortCol]);
  const colKeys = pv.colKeys.slice(-24);
  if (bulk.error) return <ErrorBox error={bulk.error} />;
  const title = t('pivot.resultTitle', { disease: diseaseName(core, disease), fn: t('pivot.fn.' + fn), value: t('pivot.col.' + value), rows: t('pivot.col.' + rowsBy) });
  const prov = bulkProv(core, disease, title, 'pivot', { rows: rowsBy, columns: colsBy, value, fn });
  const linked: SeriesData | null = sel && colsBy ? { id: sel, label: sel, p: pv.colKeys, v: pv.colKeys.map((c) => pv.cells[sel]?.[c] ?? null), ptype: 'Y' } : null;
  return (
    <>
      <h2>{t('pivot.title')}</h2>
      <p class="muted">{t('pivot.lead')}</p>
      <section class="card">
        <div class="tools">
          <label>{t('filter.disease')} <select value={disease} onChange={(e) => { setDisease((e.target as HTMLSelectElement).value); setSel(null); }}>{tsDiseases.map((d: any) => <option key={d.id} value={d.id}>{diseaseName(core, d.id)}</option>)}</select></label>
          <label>{t('pivot.rows')} <select value={rowsBy} onChange={(e) => setRowsBy((e.target as HTMLSelectElement).value)}>{dims.map((d) => <option key={d} value={d}>{t('pivot.col.' + d)}</option>)}</select></label>
          <label>{t('pivot.columns')} <select value={colsBy} onChange={(e) => setColsBy((e.target as HTMLSelectElement).value)}><option value="">{t('pivot.none')}</option>{dims.map((d) => <option key={d} value={d}>{t('pivot.col.' + d)}</option>)}</select></label>
          <label>{t('pivot.value')} <select value={value} onChange={(e) => setValue((e.target as HTMLSelectElement).value)}>{['value', 'rate_per_100k'].map((d) => <option key={d} value={d}>{t('pivot.col.' + d)}</option>)}</select></label>
          <label>{t('sql.aggregate')} <select value={fn} onChange={(e) => setFn((e.target as HTMLSelectElement).value as any)}>{['sum', 'mean', 'max', 'count'].map((d) => <option key={d} value={d}>{t('pivot.fn.' + d)}</option>)}</select></label>
        </div>
        {f.ui(bulk.data ?? [])}
        {bulk.loading && <Loading />}
        <Guards rows={filtered} groupCols={[rowsBy, colsBy]} onRestrict={f.restrict} />
        <header><h3>{title}</h3><SourceChip prov={prov} /></header>
        <div class="tablewrap" tabIndex={0} role="region" aria-label={title}>
          <table class="data">
            <thead><tr><th scope="col"><button type="button" class="btn small" onClick={() => setSortCol('__key')}>{t('pivot.col.' + rowsBy)}</button></th>{colKeys.map((c) => <th scope="col" class="n" key={c}><button type="button" class="btn small" onClick={() => setSortCol(c)} aria-label={t('pivot.sortBy', { col: c })}>{c}</button></th>)}<th scope="col" class="n"><button type="button" class="btn small" onClick={() => setSortCol('__total')}>{t('pivot.total')}</button></th></tr></thead>
            <tbody>{sortedRows.slice(0, 300).map((rk) => <tr key={rk} aria-selected={sel === rk}><th scope="row"><button type="button" class="btn small" onClick={() => setSel(rk)}>{rk}</button></th>{colKeys.map((c) => <td class="n" key={c}>{pv.cells[rk][c] === null || pv.cells[rk][c] === undefined ? <span class="muted">–</span> : smart(pv.cells[rk][c])}</td>)}<td class="n"><b>{smart(pv.rowTotals[rk])}</b></td></tr>)}</tbody>
          </table>
        </div>
        <p class="small muted">{t('pivot.note', { rows: num(filtered.length) })}</p>
        {linked && <><h3>{t('pivot.linked', { name: sel! })}</h3><Chart series={[linked]} xMode="index" ariaLabel={t('pivot.linked', { name: sel! })} xLabel={t('pivot.col.' + colsBy)} compact /></>}
        <div class="btnrow">
          <button type="button" class="btn small" onClick={() => exportBundle(core, prov, sortedRows.map((rk) => ({ [rowsBy]: rk, ...Object.fromEntries(pv.colKeys.map((c) => [c, pv.cells[rk][c]])), total: pv.rowTotals[rk], source_id: prov.sourceIds.join(';'), snapshot_id: prov.snapshotId })), 'csv', 'pivot-' + disease)}>{t('action.downloadCsv')}</button>
        </div>
      </section>
    </>
  );
}

export function ChartBuilder() {
  const { core } = useApp();
  const tsDiseases = core.diseases.filter((d: any) => d.has_timeseries);
  const [disease, setDisease] = useState('measles');
  const bulk = useBulk(disease);
  const f = useFilters();
  const [mark, setMark] = useState<'line' | 'bar' | 'dot' | 'area'>('line');
  const [x, setX] = useState('period_start');
  const [y, setY] = useState('rate_per_100k');
  const [color, setColor] = useState('place_name');
  const [places, setPlaces] = useState('KEN,ETH,SOM');
  const [log, setLog] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const host = useRef<HTMLDivElement>(null);
  const plotRef = useRef<any>(null);
  const list = places.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const rows = useMemo(() => f.apply(bulk.data ?? []).filter((r) => !list.length || list.includes(String(r.iso3))).filter((r) => r[y] !== null), [bulk.data, f, places, y]);
  const title = t('builder.resultTitle', { disease: diseaseName(core, disease), y: t('pivot.col.' + y) });
  const prov = bulkProv(core, disease, title, 'chart_builder', { mark, x, y, color, places: list, log });
  const spec = { mark, x, y, color, log, disease, places: list, filters: 'see provenance', snapshot: prov.snapshotId };

  useEffect(() => {
    if (state !== 'ready' || !host.current || !plotRef.current) return;
    const Plot = plotRef.current;
    const data = rows.map((r) => ({ ...r, period_start: new Date(String(r.period_start) + 'T00:00:00Z') }));
    const ch = { x, y, [mark === 'dot' ? 'fill' : mark === 'line' ? 'stroke' : 'fill']: color || undefined } as any;
    const m = mark === 'line' ? Plot.lineY(data, { ...ch, sort: x }) : mark === 'bar' ? (x === 'period_start' ? Plot.rectY(data, { ...ch, interval: undefined, x1: x, x2: (d: any) => new Date(+d.period_start + 6 * 864e5) }) : Plot.barY(data, Plot.groupX({ y: 'sum' }, ch))) : mark === 'area' ? Plot.areaY(data, { ...ch, sort: x, fillOpacity: 0.4 }) : Plot.dot(data, ch);
    const el = Plot.plot({ width: 760, height: 360, marginLeft: 60, style: { fontFamily: 'system-ui, sans-serif', fontSize: '11px', background: '#fff' }, y: { type: log ? 'log' : 'linear', grid: true, label: t('pivot.col.' + y) }, x: { label: t('pivot.col.' + x) }, color: { legend: !!color, scheme: 'observable10' }, marks: [m, Plot.ruleY([log ? undefined : 0].filter((v) => v !== undefined))] });
    host.current.replaceChildren(el);
  }, [state, rows, mark, x, y, color, log]);

  const load = async () => { setState('loading'); try { plotRef.current = await import('@observablehq/plot'); setState('ready'); } catch { setState('error'); } };
  const svgOf = (): { svg: string; width: number; height: number } | null => {
    const svg = host.current?.querySelector('svg:last-of-type') as SVGSVGElement | null; if (!svg) return null;
    const c = svg.cloneNode(true) as SVGSVGElement; c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return { svg: new XMLSerializer().serializeToString(c), width: 760, height: 360 };
  };
  const exp = async (kind: 'png' | 'svg' | 'spec') => {
    const side = JSON.stringify({ ...provBlock(core, prov), chart_spec: spec }, null, 2);
    const base = slugify(title);
    if (kind === 'spec') { download(`${base}.spec.json`, side, 'application/json'); return; }
    const inner = svgOf(); if (!inner) return;
    const out = composeExportSVG(inner, imageMeta(core, prov, title, `${t('builder.mark.' + mark)}${log ? ' · ' + t('transform.log') : ''}`));
    const files = [{ name: `${base}.provenance.json`, data: side }, { name: `${base}.caption.txt`, data: caption(core, prov, title) + '\n' }];
    if (kind === 'svg') download(`${base}.zip`, zip([{ name: `${base}.svg`, data: out }, ...files]), 'application/zip');
    else download(`${base}.zip`, zip([{ name: `${base}.png`, data: new Uint8Array(await (await svgToPngBlob(out)).arrayBuffer()) }, ...files]), 'application/zip');
  };
  if (bulk.error) return <ErrorBox error={bulk.error} />;
  return (
    <>
      <h2>{t('builder.title')}</h2>
      <p class="muted">{t('builder.lead')}</p>
      <section class="card">
        <div class="tools">
          <label>{t('filter.disease')} <select value={disease} onChange={(e) => setDisease((e.target as HTMLSelectElement).value)}>{tsDiseases.map((d: any) => <option key={d.id} value={d.id}>{diseaseName(core, d.id)}</option>)}</select></label>
          <label>{t('builder.places')} <input type="text" value={places} onInput={(e) => setPlaces((e.target as HTMLInputElement).value)} aria-describedby="places-help" /></label>
          <label>{t('builder.markLabel')} <select value={mark} onChange={(e) => setMark((e.target as HTMLSelectElement).value as any)}>{['line', 'bar', 'area', 'dot'].map((m) => <option key={m} value={m}>{t('builder.mark.' + m)}</option>)}</select></label>
          <label>X <select value={x} onChange={(e) => setX((e.target as HTMLSelectElement).value)}>{['period_start', 'year', 'place_name', 'region'].map((d) => <option key={d} value={d}>{t('pivot.col.' + d)}</option>)}</select></label>
          <label>Y <select value={y} onChange={(e) => setY((e.target as HTMLSelectElement).value)}>{['rate_per_100k', 'value'].map((d) => <option key={d} value={d}>{t('pivot.col.' + d)}</option>)}</select></label>
          <label>{t('builder.color')} <select value={color} onChange={(e) => setColor((e.target as HTMLSelectElement).value)}><option value="">{t('pivot.none')}</option>{['place_name', 'region', 'case_definition', 'source_id', 'metric'].map((d) => <option key={d} value={d}>{t('pivot.col.' + d)}</option>)}</select></label>
          <label><input type="checkbox" checked={log} onChange={(e) => setLog((e.target as HTMLInputElement).checked)} /> {t('transform.log')}</label>
        </div>
        <p id="places-help" class="small muted">{t('builder.placesHelp')}</p>
        {f.ui(bulk.data ?? [])}
        <Guards rows={rows} groupCols={[color, x]} onRestrict={f.restrict} />
        <header><h3>{title}</h3><SourceChip prov={prov} /></header>
        {bulk.loading && <Loading />}
        {state === 'idle' && <button type="button" class="btn primary" onClick={load}>{t('builder.load')}</button>}
        {state === 'loading' && <Loading />}
        {state === 'error' && <div class="notice warn" role="alert">{t('state.error')}</div>}
        <div ref={host} role="img" aria-label={`${title}. ${t('builder.alt', { n: rows.length })}`} style={{ overflowX: 'auto' }} />
        {state === 'ready' && (
          <>
            <details class="more"><summary>{t('builder.table', { n: rows.length })}</summary>
              <div class="tablewrap" tabIndex={0}><table class="data"><thead><tr><th>{t('pivot.col.' + x)}</th>{color && <th>{t('pivot.col.' + color)}</th>}<th class="n">{t('pivot.col.' + y)}</th></tr></thead><tbody>{rows.slice(0, 300).map((r, i) => <tr key={i}><td>{String(r[x])}</td>{color && <td>{String(r[color])}</td>}<td class="n">{smart(r[y] as number)}</td></tr>)}</tbody></table></div></details>
            <div class="btnrow"><button type="button" class="btn small" onClick={() => exp('png')}>{t('action.png')}</button><button type="button" class="btn small" onClick={() => exp('svg')}>{t('action.svg')}</button><button type="button" class="btn small" onClick={() => exp('spec')}>{t('builder.spec')}</button></div>
          </>
        )}
      </section>
    </>
  );
}
