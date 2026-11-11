/** Subnational card: one disease's reported counts by first-level region for one country and year.
 *  Counts only (no population at this level), definitions differ between regions and years, and names the pipeline
 *  could not match to a boundary are listed in the table but never drawn. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getOptional } from '../lib/data';
import { caption, exportImage, imageMeta, serializeSvg } from '../lib/exporters';
import { num, t } from '../lib/i18n';
import { provBlock, type Prov } from '../lib/prov';
import { placeName } from '../lib/series';
import { diseaseName, useAsync } from './Layout';
import { CiteButton } from './Cite';
import { MapLegend, quantileBreaks } from './mapUtil';
import { SourceChip, useApp } from './SourceChip';

interface Unit { id: string | null; name: string | null; name_in_source: string; values: (number | null)[]; definitions: (string | null)[]; resolution: (string | null)[]; conflict_years?: number[] }
interface RegionFile { iso3: string; years: number[]; units: Unit[]; n_units: number; n_matched: number; conflicts: string[]; unmatched_names: string[]; source_ids: string[]; method: { name: string; version: string }; fetches: { data: { retrieved_at: string } }; release: string }

export function Regions({ disease, iso3 }: { disease: string; iso3: string }) {
  const { core, route } = useApp();
  const file = useAsync(() => getOptional<RegionFile>(`subnational/${disease}/${iso3}.json`), [disease, iso3]);
  const [stat, setStat] = useState<any>(null);
  const [year, setYear] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const d = file.data;
  useEffect(() => { if (d && !stat) import('./StaticMap').then(setStat).catch(() => undefined); }, [d]);
  // years in which at least one drawn region has a value
  const years = useMemo(() => (d ? d.years.filter((_, i) => d.units.some((u) => u.id && u.values[i] !== null)) : []), [d]);
  const y = year !== null && years.includes(year) ? year : years[years.length - 1];
  const yi = d ? d.years.indexOf(y) : -1;
  const model = useMemo(() => {
    if (!d || yi < 0) return null;
    const values: Record<string, number | null> = {}; const labels: Record<string, string> = {};
    for (const u of d.units) {
      if (!u.id) continue;
      const v = u.values[yi];
      if (v === null) continue;
      if (u.conflict_years?.includes(y)) { values[u.id] = null; labels[u.id] = t('regions.conflict'); continue; }
      values[u.id] = v; labels[u.id] = `${num(v)} · ${u.definitions[yi] ?? ''}`;
    }
    // one scale for every year, so years can be compared
    const breaks = quantileBreaks(d.units.filter((u) => u.id).flatMap((u) => u.values).filter((x): x is number => x !== null && x > 0));
    return { values, labels, breaks };
  }, [d, yi]);
  if (!d || !model || !years.length) return null;
  const name = placeName(core, iso3);
  const title = t('regions.title', { disease: diseaseName(core, disease), name, year: String(y) });
  const prov: Prov = { title, origin: 'site-derived', sourceIds: d.source_ids, asOf: d.fetches.data.retrieved_at.slice(0, 10), snapshotId: route.snapshot ?? core.manifest.snapshot_id, method: d.method,
    notes: [t('regions.note.release', { release: d.release })] };
  const rows = d.units.filter((u) => u.values[yi] !== null).sort((a, b) => (b.values[yi] as number) - (a.values[yi] as number));
  const doExport = async (kind: 'png' | 'svg') => {
    if (!svgRef.current) return;
    await exportImage(kind, serializeSvg(svgRef.current), imageMeta(core, prov, title, t('regions.metric')), title, provBlock(core, prov), caption(core, prov, title, t('regions.metric')),
      `${title}. ${rows.slice(0, 5).map((u) => `${u.name ?? u.name_in_source}: ${num(u.values[yi] as number)}`).join('; ')}.`);
  };
  return (
    <section class="card" style={{ marginTop: '16px' }} id="place-regions">
      <header><div><h2>{title}</h2><p class="sub">{t('regions.sub', { matched: d.n_matched, total: d.n_units })}</p></div><SourceChip prov={prov} /></header>
      <div class="tools" role="group" aria-label={t('regions.year')}>
        <button type="button" class="btn small" disabled={years.indexOf(y) <= 0} aria-label={t('mappage.prev')} onClick={() => setYear(years[years.indexOf(y) - 1])}>‹</button>
        <label>{t('regions.year')} <select value={String(y)} onChange={(e) => setYear(parseInt((e.target as HTMLSelectElement).value, 10))}>{years.map((x) => <option key={x} value={String(x)}>{x}</option>)}</select></label>
        <button type="button" class="btn small" disabled={years.indexOf(y) >= years.length - 1} aria-label={t('mappage.next')} onClick={() => setYear(years[years.indexOf(y) + 1])}>›</button>
      </div>
      {!table && stat && <stat.RegionMap svgRef={svgRef} iso3={iso3} values={model.values} labels={model.labels} breaks={model.breaks} title={t('map.aria', { title })} />}
      {!table && <MapLegend breaks={model.breaks} title={t('regions.metric')} />}
      {table && (
        <div class="tablewrap" tabIndex={0}><table class="data">
          <thead><tr><th scope="col">{t('regions.col.region')}</th><th scope="col">{t('regions.col.source')}</th><th scope="col" class="n">{t('regions.metric')}</th><th scope="col">{t('regions.col.definition')}</th><th scope="col">{t('regions.col.onMap')}</th></tr></thead>
          <tbody>{rows.map((u) => <tr key={u.name_in_source}><th scope="row">{u.name ?? '–'}</th><td>{u.name_in_source}</td><td class="n">{num(u.values[yi] as number)}</td><td>{u.definitions[yi]}</td>
            <td>{!u.id ? t('regions.notMatched') : u.conflict_years?.includes(y) ? t('regions.conflict') : t('regions.yes')}</td></tr>)}</tbody>
        </table></div>
      )}
      <p class="means">{t('regions.means')} {d.unmatched_names.length > 0 && t('regions.means.unmatched', { n: d.unmatched_names.length })} {d.conflicts.length > 0 && t('regions.means.conflicts', { n: d.conflicts.length })}</p>
      <div class="btnrow">
        <button type="button" class="btn small" onClick={() => setTable(!table)}>{table ? t('action.viewMap') : t('action.viewData')}</button>
        <button type="button" class="btn small" disabled={table} onClick={() => doExport('png')}>{t('action.png')}</button>
        <button type="button" class="btn small" disabled={table} onClick={() => doExport('svg')}>{t('action.svg')}</button>
        <CiteButton prov={prov} title={title} subtitle={t('regions.metric')} />
      </div>
    </section>
  );
}
