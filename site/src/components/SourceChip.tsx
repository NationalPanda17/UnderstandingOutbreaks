/** Source chip (always visible) and the "Trace this" panel (one click). Full lineage is one more click in Simple mode. */
import { createContext } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { SITE, dataUrl, type Route } from '../lib/app';
import { getOptional, type Core, type Fetch } from '../lib/data';
import { date, t, snapLabel } from '../lib/i18n';
import { chainFor, originIcon, sourceLinks, suggestedCitation, type Prov } from '../lib/prov';
import { copyText } from '../lib/exporters';

export const AppCtx = createContext<{ core: Core; route: Route }>(null as any);
export function useApp() { return useContext(AppCtx); }

export function sourceNames(core: Core, prov: Prov): string {
  const names = prov.sourceIds.map((s) => core.sources[s]?.short_name ?? s);
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
}

/** Supporting inputs (population, place names, boundaries, this site's own calculations): never the headline source. */
const SUPPORTING = new Set(['worldbank', 'geonames', 'naturalearth', 'uo_site']);
/** The source a reader would name: the first reporting source, with a count of the others. */
export function primarySource(core: Core, prov: Prov): string {
  const main = prov.sourceIds.filter((s) => !SUPPORTING.has(s));
  const ids = main.length ? main : prov.sourceIds;
  const first = core.sources[ids[0]]?.short_name ?? ids[0] ?? '';
  return ids.length > 1 ? `${first} +${ids.length - 1}` : first;
}

export function SourceChip({ prov, compact }: { prov: Prov; compact?: boolean }) {
  const { core } = useApp();
  const [open, setOpen] = useState(false);
  const basis = prov.series?.length ? core.seriesByKey[prov.series[0].skey]?.date_basis : undefined;
  // Shown on the chip: who published it and how recent it is. The full label (kind of figure, every source, what the
  // dates mean) is the chip's accessible name and tooltip, and the panel it opens.
  const full = `${t('origin.' + prov.origin)} · ${sourceNames(core, prov)}${prov.asOf ? ' · ' + t('chip.asOf', { date: date(prov.asOf) }) : ''}${basis ? ' · ' + t('datebasis.short.' + basis) : ''}`;
  // Reported figures read "Source: …"; figures this site calculated read "Calculated from …". Simulated, user-supplied
  // and test data keep their full label: what they are must never be one click away.
  const plainOrigin = prov.origin === 'source-reported' || prov.origin === 'site-derived';
  const label = plainOrigin && prov.sourceIds.length
    ? `${t(prov.origin === 'site-derived' ? 'chip.derived' : 'chip.source', { source: primarySource(core, prov) })}${prov.asOf ? ' · ' + date(prov.asOf) : ''}` : full;
  return (
    <>
      <button type="button" class="chip" data-origin={prov.origin} data-testid="source-chip" onClick={() => setOpen(true)}
        aria-haspopup="dialog" title={`${t('chip.trace')}: ${full}`} aria-label={label === full ? `${t('chip.trace')}: ${full}` : `${label}. ${t('chip.trace')}: ${full}`}>
        <span class="ico" aria-hidden="true">{originIcon(prov.origin)}</span>
        <span class="txt">{compact && plainOrigin ? primarySource(core, prov) : compact ? sourceNames(core, prov) : label}</span>
      </button>
      {open && <TracePanel prov={prov} onClose={() => setOpen(false)} />}
    </>
  );
}

export function Dialog({ title, onClose, children, modal }: { title: string; onClose: () => void; children: any; modal?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0]; const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, []);
  return (
    <div class={'overlay' + (modal ? ' modal' : '')} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="panel" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div class="row"><h2>{title}</h2><button type="button" class="btn small" onClick={onClose}>{t('action.close')}</button></div>
        {children}
      </div>
    </div>
  );
}

function ExtLink({ url, children }: { url: string; children: any }) {
  const ext = /^https?:/.test(url);
  return <a href={url} class={ext ? 'ext' : undefined} target={ext ? '_blank' : undefined} rel={ext ? 'noopener noreferrer' : undefined}>{children}</a>;
}

/** "How this number got here" in three plain steps: who published it, when this site stored it, what was calculated. */
export function PlainSteps({ prov }: { prov: Prov }) {
  const { core } = useApp();
  return (
    <div class="plain" data-testid="plain-trace">
      <b>{t('plain.title')}</b>
      <ol>
        <li>{t(prov.origin === 'simulated' ? 'plain.simulated' : prov.origin === 'user-supplied' ? 'plain.user' : 'plain.published', { sources: sourceNames(core, prov) })}</li>
        {prov.origin !== 'simulated' && prov.origin !== 'user-supplied' && <li>{prov.asOf ? t(prov.asOfKind === 'published' ? 'plain.publishedOn' : 'plain.retrieved', { date: date(prov.asOf, 'long'), snapshot: snapLabel(prov.snapshotId) }) : t('plain.snapshotOnly', { snapshot: snapLabel(prov.snapshotId) })}</li>}
        <li>{prov.method ? <>{t('plain.calculated')} {t('method.' + prov.method.name)}</> : (prov.transforms?.length ? t('plain.transformed') : t('plain.asReported'))}{prov.method && !!prov.transforms?.length && <> {t('plain.transformed')}</>}</li>
      </ol>
    </div>
  );
}

export function TracePanel({ prov, onClose }: { prov: Prov; onClose: () => void }) {
  const { core, route } = useApp();
  const [full, setFull] = useState(route.mode === 'analyst');
  const [lineage, setLineage] = useState<Record<string, any>>({});
  const [linkStatus, setLinkStatus] = useState<Record<string, any>>({});
  const [copied, setCopied] = useState(false);
  const links = sourceLinks(core, prov);
  const metas = (prov.series ?? []).map((it) => ({ it, m: core.seriesByKey[it.skey] })).filter((x) => x.m);

  useEffect(() => {
    getOptional<any>('quality.json').then((q) => {
      const st: Record<string, any> = {};
      for (const d of q?.datasets ?? []) st[d.dataset_id] = d.link_check;
      setLinkStatus(st);
    });
  }, []);
  useEffect(() => {
    if (!full) return;
    for (const { it, m } of metas) {
      if (!it.iso3) continue;
      const k = `${m.disease}/${it.iso3}`;
      if (lineage[k]) continue;
      getOptional<any>(`lineage/${k}.json`).then((l) => l && setLineage((prev) => ({ ...prev, [k]: l })));
    }
  }, [full]);

  const fetchesFor = (dataset: string): Fetch[] => Object.values(core.fetches).filter((f) => f.dataset_id === dataset);
  const citation = suggestedCitation(core, prov);

  return (
    <Dialog title={t('trace.title')} onClose={onClose}>
      <p><b>{prov.title}</b></p>
      <p class="chipline"><span class="badge" data-origin={prov.origin}>{originIcon(prov.origin)} {t('origin.' + prov.origin)}</span></p>
      <p class="muted">{t('origin.' + prov.origin + '.explain')}</p>
      <PlainSteps prov={prov} />
      <dl>
        <dt>{t('trace.asOf')}</dt><dd>{prov.asOf ? date(prov.asOf, 'long') : t('trace.notApplicable')}</dd>
        <dt>{t('trace.version')}</dt><dd>{snapLabel(prov.snapshotId)}{full && <> <code class="small">{prov.snapshotId}</code></>}</dd>
        {!!prov.caseDefinitions?.length && (<><dt>{t('trace.caseDefinition')}</dt><dd>{prov.caseDefinitions.map((c) => t('def.' + c)).join('; ')}</dd></>)}
        {prov.method && (<><dt>{t('trace.method')}</dt><dd><code>{prov.method.name}</code> v{prov.method.version} — {t('method.' + prov.method.name)}</dd></>)}
        {prov.sim && (<><dt>{t('trace.simulation')}</dt><dd>{t('trace.simLine', { engine: prov.sim.engineVersion, spec: prov.sim.specVersion, solver: prov.sim.solver, seed: prov.sim.seed === null ? '–' : String(prov.sim.seed) })}</dd></>)}
      </dl>

      <h3>{prov.origin === 'simulated' ? t('trace.references') : t('trace.originalSources')}</h3>
      {prov.sourceIds.map((sid) => {
        const s = core.sources[sid];
        if (!s) return <div class="src" key={sid}><code>{sid}</code></div>;
        const mine = links.filter((l) => l.sourceId === sid);
        const ds = Array.from(new Set(metas.filter((x) => x.m.source_id === sid).map((x) => x.m.dataset_id)));
        return (
          <div class="src" key={sid}>
            <b>{s.name}</b>{s.stale && <> <span class="badge stale">{t('badge.stale')}</span></>}
            <div class="small muted">{s.publisher}</div>
            <ul class="list small">
              {(mine.length ? mine : [{ label: s.short_name, url: s.landing_url, kind: 'dataset-level link' }]).map((l) => {
                const st = ds.map((d) => linkStatus[d]).find((x) => x && x.url && l.url.startsWith(String(x.url).split('{')[0]));
                const broken = st?.status === 'broken';
                return (
                  <li key={l.url}>
                    {broken ? <span>{t('trace.linkUnavailable')} </span> : <ExtLink url={l.url}>{t('trace.openOriginal')}</ExtLink>}
                    {l.kind === 'dataset-level link' && <> <span class="badge">{t('trace.datasetLevel')}</span></>}
                    {' · '}<ExtLink url={'https://web.archive.org/web/2/' + l.url}>{t('trace.wayback')}</ExtLink>
                  </li>
                );
              })}
              {ds.flatMap((d) => fetchesFor(d).slice(0, 3)).map((f) => (
                <li key={f.fetch_id}>
                  {f.archive_public && f.archive_key
                    ? <a href={`${SITE.r2BaseUrl}/${f.archive_key}`}>{t('trace.archivedCopy')}</a>
                    : <span>{t('trace.notRedistributed')}</span>}
                  {' · '}{t('trace.retrieved', { date: date(f.retrieved_at) })}
                </li>
              ))}
            </ul>
            <div class="small">{t('trace.license')}: <ExtLink url={s.license_url}>{s.license}</ExtLink>{s.license_verification !== 'verified-live' && <> <span class="badge">{t('trace.licenseUnverified')}</span></>}</div>
          </div>
        );
      })}
      {!!prov.citations?.length && (
        <ul class="list small">
          {prov.citations.map((c) => (
            <li key={c.text}>{c.text} {c.doi && <ExtLink url={'https://doi.org/' + c.doi}>doi:{c.doi}</ExtLink>} {c.url && !c.doi && <ExtLink url={c.url}>{t('trace.link')}</ExtLink>}
              {' '}<span class="badge">{c.verified ? t('trace.verifiedOn', { date: c.verified }) : t('trace.unverified')}</span></li>
          ))}
        </ul>
      )}

      {(metas.length > 0 || prov.method || !!prov.transforms?.length) && <h3>{t('trace.transformations')}</h3>}
      {metas.length > 0 && (
        <ol class="chain">
          {Array.from(new Map(metas.map((x) => [x.m.chain_id, x.m])).values()).flatMap((m) => chainFor(core, m).map((c, i) => (
            <li key={m.chain_id + i}>{t('chain.' + c.op)}{full && <> <code class="small">{c.op} v{c.method_version} {JSON.stringify(c.params)}</code></>}</li>
          )))}
          {prov.method && <li>{t('method.' + prov.method.name)}{full && <> <code class="small">{prov.method.name} v{prov.method.version} {JSON.stringify(prov.method.params ?? {})}</code></>}</li>}
          {(prov.transforms ?? []).map((tr) => <li key={tr}>{t('transform.' + tr + '.explain')}</li>)}
        </ol>
      )}
      {metas.length === 0 && (prov.method || !!prov.transforms?.length) && (
        <ol class="chain">
          {prov.method && <li>{t('method.' + prov.method.name)}{full && <> <code class="small">{prov.method.name} v{prov.method.version} {JSON.stringify(prov.method.params ?? {})}</code></>}</li>}
          {(prov.transforms ?? []).map((tr) => <li key={tr}>{t('transform.' + tr + '.explain')}</li>)}
        </ol>
      )}
      {!!prov.notes?.length && prov.notes.map((n) => <p class="small muted" key={n}>{n}</p>)}

      {metas.length > 0 && (
        <>
          <h3>{t('trace.records')}</h3>
          <ul class="list small">
            {metas.slice(0, full ? 40 : 6).map(({ it, m }) => (
              <li key={it.skey + (it.iso3 ?? '')}>
                {core.sources[m.source_id]?.short_name} · {t('metric.' + m.metric)} · {t('def.' + m.case_definition)}{it.iso3 ? ' · ' + (core.places[it.iso3]?.name ?? it.iso3) : ''}
                {it.iso3 && <> — <a href={dataUrl(`ts/${m.disease}/${it.iso3}.json`)}>{t('trace.values')}</a> · <a href={dataUrl(`lineage/${m.disease}/${it.iso3}.json`)}>{t('trace.lineageFile')}</a></>}
                {full && (
                  <div class="muted">
                    <code>{it.iso3 ? `${it.skey}.${it.iso3}` : it.skey}</code><br />
                    {m.case_definition_note}<br />{m.surveillance_system_note}
                    {m.date_basis && <><br />{t('datebasis.label')}: {t('datebasis.' + m.date_basis)}{m.date_basis_field ? ` (${t('datebasis.field', { field: m.date_basis_field })})` : ''}</>}
                    {fetchesFor(m.dataset_id).slice(0, 3).map((f) => <div key={f.fetch_id}><code>{f.fetch_id}</code> sha256 <code>{f.raw_file_hash.slice(0, 20)}…</code> · {f.retrieved_at}</div>)}
                    {it.iso3 && lineage[`${m.disease}/${it.iso3}`]?.series?.[it.skey] && (
                      <div>{t('trace.rawRefs')}: <code>{lineage[`${m.disease}/${it.iso3}`].series[it.skey].r.slice(-2).join(' | ')}</code></div>
                    )}
                    {m.inputs.length > 0 && <div>{t('trace.inputs')}: {m.inputs.map((k) => <code key={k}>{k} </code>)}</div>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {!full && <p><button type="button" class="btn" onClick={() => setFull(true)}>{t('trace.showFull')}</button></p>}

      <h3>{t('trace.cite')}</h3>
      <p class="small">{citation}</p>
      <button type="button" class="btn small" onClick={async () => setCopied(await copyText(citation))}>{copied ? t('action.copied') : t('action.copyCitation')}</button>
      <p class="small muted">{t('trace.footer')}</p>
    </Dialog>
  );
}
