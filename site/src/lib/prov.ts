/** Provenance descriptor attached to everything the site shows or exports. See docs/PROVENANCE.md. */
import { SITE, absoluteUrl } from './app';
import type { ChainStep, Core, Origin, Place, SeriesMeta } from './data';
import { deepLink } from './data';

export interface ProvLink { label: string; url: string; kind?: string; sourceId?: string; external?: boolean }
export interface ProvCitation { text: string; doi?: string; url?: string; verified?: string | null }
export interface Prov {
  /** What is being traced, in the viewer's words (already translated). */
  title: string;
  origin: Origin;
  /** Every contributing source id from the registry. Blended views list them all. */
  sourceIds: string[];
  /** "Data as of" date (ISO). */
  asOf: string | null;
  /** What the date is: when this site retrieved the data (default), or when the source published its latest notice. */
  asOfKind?: 'retrieved' | 'published';
  snapshotId: string;
  /** Underlying series (for lineage links and per-record traces). */
  series?: { skey: string; iso3?: string }[];
  /** Site-derived method, when origin is site-derived. */
  method?: { name: string; version: string; params?: Record<string, unknown> };
  /** Active view transforms (translation keys under transform.*). */
  transforms?: string[];
  /** Direct links to original notices or pages. */
  links?: ProvLink[];
  /** Extra plain-language notes (already translated). */
  notes?: string[];
  /** Simulation runs: spec + seed + engine version. */
  sim?: { engineVersion: string; specVersion: string; seed: number | null; solver: string; specUrl?: string };
  citations?: ProvCitation[];
  caseDefinitions?: string[];
}

const ORIGIN_ICON: Record<Origin, string> = {
  'source-reported': '◆', 'site-derived': '∑', 'user-supplied': '✎', simulated: '◌', 'test-data': '⚠',
};
export function originIcon(o: Origin): string { return ORIGIN_ICON[o]; }

export function seriesProv(core: Core, title: string, items: { skey: string; iso3?: string }[], snapshot: string | null, extra: Partial<Prov> = {}): Prov {
  const metas = items.map((i) => core.seriesByKey[i.skey]).filter(Boolean);
  const sourceIds = Array.from(new Set(metas.flatMap((m) => [m.source_id, ...m.inputs.map((k) => core.seriesByKey[k]?.source_id).filter(Boolean)]))) as string[];
  const derived = metas.some((m) => m.origin_type === 'site-derived') || !!extra.transforms?.length || !!extra.method;
  const asOf = metas.map((m) => m.retrieved_at).filter(Boolean).sort().pop() ?? null;
  return {
    title, origin: derived ? 'site-derived' : 'source-reported', sourceIds: Array.from(new Set([...sourceIds, ...(extra.sourceIds ?? [])])),
    asOf: asOf ? asOf.slice(0, 10) : null, snapshotId: snapshot ?? core.manifest.snapshot_id, series: items,
    caseDefinitions: Array.from(new Set(metas.map((m) => m.case_definition))), ...extra,
    ...(extra.sourceIds ? { sourceIds: Array.from(new Set([...sourceIds, ...extra.sourceIds])) } : {}),
  };
}

export function chainFor(core: Core, meta: SeriesMeta): ChainStep[] { return core.chains[meta.chain_id] ?? []; }

export function sourceLinks(core: Core, prov: Prov, places?: Record<string, Place>): ProvLink[] {
  const out: ProvLink[] = [...(prov.links ?? [])];
  const seen = new Set(out.map((l) => l.url));
  for (const it of prov.series ?? []) {
    const m = core.seriesByKey[it.skey];
    if (!m) continue;
    const url = deepLink(m, it.iso3 ? places?.[it.iso3] ?? core.places[it.iso3] : undefined);
    if (!seen.has(url)) { seen.add(url); out.push({ label: core.sources[m.source_id]?.short_name ?? m.source_id, url, kind: m.link_kind, sourceId: m.source_id, external: true }); }
  }
  for (const sid of prov.sourceIds) {
    const s = core.sources[sid];
    if (s && !out.some((l) => l.sourceId === sid) && !seen.has(s.landing_url)) out.push({ label: s.short_name, url: s.landing_url, kind: 'dataset-level link', sourceId: sid, external: s.landing_url.startsWith('http') });
  }
  return out;
}

export function suggestedCitation(core: Core, prov: Prov): string {
  const names = prov.sourceIds.map((s) => core.sources[s]?.short_name ?? s).join('; ');
  const d = prov.asOf ? ` Data as of ${prov.asOf}.` : '';
  return `${SITE.identity.creator}. ${SITE.name}: ${prov.title}. Snapshot ${prov.snapshotId}.${d} Sources: ${names}. ${SITE.shortUrl}`;
}

/** Machine-readable provenance block attached to every export, embed and image sidecar. */
export function provBlock(core: Core, prov: Prov, viewUrl?: string): Record<string, unknown> {
  return {
    title: prov.title,
    origin_type: prov.origin,
    snapshot_id: prov.snapshotId,
    data_as_of: prov.asOf,
    view_url: viewUrl ?? (typeof window !== 'undefined' ? absoluteUrl(window.location.pathname + window.location.search) : undefined),
    sources: prov.sourceIds.map((id) => {
      const s = core.sources[id];
      return s ? { source_id: id, name: s.name, publisher: s.publisher, url: s.landing_url, license: s.license, license_url: s.license_url, citation: s.citation } : { source_id: id };
    }),
    source_urls: sourceLinks(core, prov).map((l) => ({ source_id: l.sourceId, url: l.url, link_kind: l.kind })),
    retrieval: (prov.series ?? []).map((it) => {
      const m = core.seriesByKey[it.skey];
      return m ? { series: it.iso3 ? `${it.skey}.${it.iso3}` : it.skey, retrieved_at: m.retrieved_at, dataset_id: m.dataset_id, lineage: it.iso3 ? `${SITE.dataPath}/lineage/${m.disease}/${it.iso3}.json` : undefined } : { series: it.skey };
    }),
    transformations: [
      ...(prov.series ?? []).flatMap((it) => { const m = core.seriesByKey[it.skey]; return m ? chainFor(core, m).map((c) => ({ series: it.skey, ...c })) : []; }),
      ...(prov.method ? [{ op: prov.method.name, method_version: prov.method.version, params: prov.method.params ?? {} }] : []),
      ...(prov.transforms ?? []).map((tr) => ({ op: `view:${tr}`, method_version: '1', params: {} })),
    ],
    case_definitions: prov.caseDefinitions,
    simulation: prov.sim,
    citations: prov.citations,
    suggested_citation: suggestedCitation(core, prov),
    disclaimer: 'Aggregated from official public reports. Not a surveillance system, not an early-warning or forecasting service, not medical advice.',
  };
}
