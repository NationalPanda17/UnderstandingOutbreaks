/** Exports: CSV/JSON bundles with provenance, SVG/PNG images with baked-in source lines, captions and citations.
 *
 * Rule: no export leaves the site without provenance. Mixed-source tables keep per-row source_id and source_url.
 */
import { SITE } from './app';
import type { Core } from './data';
import { deepLink } from './data';
import { provBlock, suggestedCitation, type Prov } from './prov';
import type { SeriesData } from './transforms';

export type Row = Record<string, string | number | boolean | null | undefined>;

export function toCSV(rows: Row[], columns?: string[]): string {
  const cols = columns ?? Array.from(rows.reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set<string>()));
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

/** Long-format rows for a set of series, each row carrying its own source id and URL. */
export function seriesRows(core: Core, series: SeriesData[], prov: Prov): Row[] {
  const rows: Row[] = [];
  for (const s of series) {
    const meta = s.skey ? core.seriesByKey[s.skey] : undefined;
    const place = s.iso3 ? core.places[s.iso3] : undefined;
    s.p.forEach((period, i) => {
      rows.push({
        series: s.label, iso3: s.iso3 ?? '', period_start: period, period_type: s.ptype, value: s.v[i],
        likely_incomplete: s.incompleteFrom ? period >= s.incompleteFrom : false,
        origin_type: s.userSupplied ? 'user-supplied' : s.simulated ? 'simulated' : prov.transforms?.length ? 'site-derived' : meta?.origin_type ?? prov.origin,
        case_definition: meta?.case_definition ?? '', metric: meta?.metric ?? '',
        source_id: s.userSupplied ? 'user-supplied' : meta?.source_id ?? prov.sourceIds.join(';'),
        source_url: meta ? deepLink(meta, place) : '',
        record_id: meta && s.iso3 ? `${s.skey}.${s.iso3}@${period}` : '',
        snapshot_id: prov.snapshotId, transforms: (prov.transforms ?? []).join(';'),
      });
    });
  }
  return rows;
}

// ---------------------------------------------------------------- minimal ZIP (stored, no compression)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function zip(files: { name: string; data: Uint8Array | string }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const name = enc.encode(f.name);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const csize = central.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, b) => s + b.length, 0));
  let o = 0;
  for (const b of all) { out.set(b, o); o += b.length; }
  return out;
}

export function download(filename: string, data: string | Uint8Array | Blob, mime = 'application/octet-stream'): void {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'export';
}

const DICT_NOTE = `See ${SITE.dataPath}/catalog/dictionary.json for the full data dictionary.`;
export const ROW_DICTIONARY: Record<string, string> = {
  series: 'Series label as shown on screen.', iso3: 'ISO 3166-1 alpha-3 country code.', period_start: 'First day of the reporting period.',
  period_type: 'W = ISO week, M = month, Y = year.', value: 'Value shown on screen, after the listed transforms.',
  likely_incomplete: 'True for recent periods that are probably still being reported or revised.',
  origin_type: 'source-reported, site-derived, user-supplied or simulated.', case_definition: 'Case definition of the series.',
  metric: 'cases, deaths, detections or specimens_processed.', source_id: 'Source id from the registry (/data/v1/sources.json).',
  source_url: 'Deep link to the original dataset or query.', record_id: 'Stable record id; resolve it with the lineage endpoint.',
  snapshot_id: 'Immutable snapshot the values come from.', transforms: 'View transforms applied, in order.',
};

/** Build the files of an export bundle (data + provenance sidecar + dictionary). Pure: used by tests too. */
export function buildBundle(core: Core, prov: Prov, rows: Row[], format: 'csv' | 'json', base: string, dictionary: Record<string, string> = ROW_DICTIONARY): { name: string; data: string }[] {
  const block = provBlock(core, prov);
  const files: { name: string; data: string }[] = [];
  if (format === 'csv') files.push({ name: `${base}.csv`, data: toCSV(rows) });
  else files.push({ name: `${base}.json`, data: JSON.stringify({ provenance: block, data: rows }, null, 2) });
  files.push({ name: `${base}.provenance.json`, data: JSON.stringify(block, null, 2) });
  files.push({ name: `${base}.dictionary.json`, data: JSON.stringify({ note: DICT_NOTE, columns: dictionary }, null, 2) });
  files.push({ name: 'CITATION.txt', data: suggestedCitation(core, prov) + '\n\nSource citations:\n' + prov.sourceIds.map((s) => '- ' + (core.sources[s]?.citation ?? s) + ' License: ' + (core.sources[s]?.license ?? 'see source')).join('\n') + '\n' });
  return files;
}

export function exportBundle(core: Core, prov: Prov, rows: Row[], format: 'csv' | 'json', name: string): void {
  const base = slugify(name);
  download(`${base}.zip`, zip(buildBundle(core, prov, rows, format, base)), 'application/zip');
}

// ---------------------------------------------------------------- captions and images

export function caption(core: Core, prov: Prov, title: string, subtitle?: string): string {
  const src = prov.sourceIds.map((s) => core.sources[s]?.short_name ?? s).join(', ');
  const lic = Array.from(new Set(prov.sourceIds.map((s) => core.sources[s]?.license).filter(Boolean))).join('; ');
  const kind = prov.origin === 'simulated'
    ? 'Illustrative simulation: not a forecast, not fitted to data.'
    : prov.origin === 'site-derived' ? 'Computed by Understanding Outbreaks from the sources listed.' : 'As reported by the sources listed.';
  const sim = prov.sim ? ` Engine ${prov.sim.engineVersion}, ${prov.sim.solver}${prov.sim.seed !== null ? ', seed ' + prov.sim.seed : ''}.` : '';
  return `${title}${subtitle ? ' (' + subtitle + ')' : ''}. ${kind}${sim} ${prov.origin === 'simulated' ? 'References' : 'Source'}: ${src}.${prov.asOf ? ' Data as of ' + prov.asOf + '.' : ''} ${lic ? 'License: ' + lic + '. ' : ''}Via ${SITE.name} (${SITE.shortUrl}), snapshot ${prov.snapshotId}.`;
}

/** The one caveat that should travel with every chart of reported numbers, including when it is screenshotted. */
export const CAVEAT = 'Reported numbers arrive late, miss cases that were never tested or reported, and use definitions that differ between sources.';

/** Address of exactly this view, pinned to the snapshot it was drawn from, so the numbers cannot change under a citation. */
export function pinnedUrl(snapshotId: string): string {
  const u = new URL(window.location.href);
  u.searchParams.set('snapshot', snapshotId);
  u.hash = '';
  return u.toString();
}

/** Everything a reporter needs to cite a view, in one paste: plain caption with the as-of date, attribution line, caveat, pinned link. */
export function citeText(core: Core, prov: Prov, title: string, subtitle?: string): string {
  const src = prov.sourceIds.map((s) => core.sources[s]?.short_name ?? s).join(', ');
  const lic = Array.from(new Set(prov.sourceIds.map((s) => core.sources[s]?.license).filter(Boolean))).join('; ');
  const sim = prov.origin === 'simulated';
  return [
    `${title}${subtitle ? ' (' + subtitle + ')' : ''}.${prov.asOf ? ' Data as of ' + prov.asOf + '.' : ''}`,
    `${sim ? 'Illustrative simulation: not a forecast, not fitted to data. References' : 'Source'}: ${src}${prov.origin === 'site-derived' ? `; calculated by ${SITE.name}` : ''}. Via ${SITE.name} (${SITE.shortUrl}).${lic ? ' License: ' + lic + '.' : ''}`,
    sim ? '' : CAVEAT,
    `Link to exactly this view (snapshot ${prov.snapshotId}): ${pinnedUrl(prov.snapshotId)}`,
  ].filter(Boolean).join('\n');
}

export function altText(series: SeriesData[], title: string): string {
  const parts = series.slice(0, 6).map((s) => {
    const vals = s.v.filter((x): x is number => x !== null);
    if (!vals.length) return `${s.label}: no data`;
    const max = Math.max(...vals); const last = vals[vals.length - 1];
    return `${s.label}: ${s.p[0]} to ${s.p[s.p.length - 1]}, highest ${Math.round(max * 100) / 100}, latest ${Math.round(last * 100) / 100}`;
  });
  return `${title}. ${parts.join('. ')}.${series.length > 6 ? ` And ${series.length - 6} more series.` : ''}`;
}

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/); const lines: string[] = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > max) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w; }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

export interface ImageMeta { title: string; subtitle?: string; sourceLine: string; licenseLine: string; asOf: string | null; shortUrl: string; watermark?: string; simLine?: string; caveatLine?: string }

export function imageMeta(core: Core, prov: Prov, title: string, subtitle?: string): ImageMeta {
  return {
    title, subtitle,
    sourceLine: (prov.origin === 'simulated' ? 'Simulated. References: ' : prov.origin === 'site-derived' ? 'Computed by Understanding Outbreaks from: ' : 'Source: ') + prov.sourceIds.map((s) => core.sources[s]?.short_name ?? s).join(', '),
    licenseLine: 'License: ' + (Array.from(new Set(prov.sourceIds.map((s) => core.sources[s]?.license).filter(Boolean))).join('; ') || 'see sources'),
    asOf: prov.asOf, shortUrl: SITE.shortUrl,
    caveatLine: prov.origin === 'simulated' ? undefined : CAVEAT,
    watermark: prov.origin === 'simulated' ? 'ILLUSTRATIVE SIMULATION · NOT A FORECAST · NOT FITTED TO DATA' : undefined,
    simLine: prov.sim ? `Engine ${prov.sim.engineVersion} · ${prov.sim.solver}${prov.sim.seed !== null ? ' · seed ' + prov.sim.seed : ''}` : undefined,
  };
}

/** Wrap a chart SVG (or a raster map image) in a frame that bakes in title, "data as of", source, license and short URL. */
export function composeExportSVG(inner: { svg?: string; imageHref?: string; width: number; height: number }, meta: ImageMeta): string {
  const W = Math.max(640, inner.width + 32);
  const titleLines = wrap(meta.title, Math.floor(W / 9));
  const foot = [meta.sourceLine, meta.licenseLine + (meta.asOf ? ` · Data as of ${meta.asOf}` : ''), ...(meta.simLine ? [meta.simLine] : []), ...(meta.caveatLine ? [meta.caveatLine] : []), meta.shortUrl].flatMap((l) => wrap(l, Math.floor(W / 6.2)));
  const top = 20 + titleLines.length * 24 + (meta.subtitle ? 20 : 0) + (meta.watermark ? 22 : 0);
  const H = top + inner.height + 16 + foot.length * 16 + 12;
  const font = 'font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"';
  let y = 30;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"><title>${esc(meta.title)}</title><desc>${esc(foot.join(' '))}</desc><rect width="${W}" height="${H}" fill="#ffffff"/>`;
  for (const l of titleLines) { out += `<text x="16" y="${y}" ${font} font-size="18" font-weight="600" fill="#17272b">${esc(l)}</text>`; y += 24; }
  if (meta.subtitle) { out += `<text x="16" y="${y - 4}" ${font} font-size="13" fill="#4a5b5f">${esc(meta.subtitle)}</text>`; y += 20; }
  if (meta.watermark) { out += `<rect x="16" y="${y - 14}" width="${W - 32}" height="20" fill="#f1eafa" stroke="#6a3d9a" stroke-dasharray="4 3"/><text x="${W / 2}" y="${y}" text-anchor="middle" ${font} font-size="11" font-weight="700" fill="#4b2a73" letter-spacing="0.5">${esc(meta.watermark)}</text>`; y += 22; }
  if (inner.svg) out += `<g transform="translate(16 ${top})">${inner.svg.replace(/<\?xml[^>]*>/, '').replace(/<svg([^>]*)>/, (_m, a) => `<svg${a.replace(/\s(width|height)="[^"]*"/g, '')} width="${inner.width}" height="${inner.height}">`)}</g>`;
  else if (inner.imageHref) out += `<image x="16" y="${top}" width="${inner.width}" height="${inner.height}" href="${inner.imageHref}" xlink:href="${inner.imageHref}"/>`;
  let fy = top + inner.height + 22;
  for (const l of foot) { out += `<text x="16" y="${fy}" ${font} font-size="11" fill="#4a5b5f">${esc(l)}</text>`; fy += 16; }
  return out + '</svg>';
}

export function serializeSvg(el: SVGSVGElement): { svg: string; width: number; height: number } {
  const clone = el.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.querySelectorAll('[data-noexport]').forEach((n) => n.remove());
  const vb = el.viewBox?.baseVal;
  const width = vb && vb.width ? vb.width : el.clientWidth || 720;
  const height = vb && vb.height ? vb.height : el.clientHeight || 360;
  return { svg: new XMLSerializer().serializeToString(clone), width, height };
}

export async function svgToPngBlob(svg: string, scale = 2): Promise<Blob> {
  const m = /width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/.exec(svg);
  const w = m ? parseFloat(m[1]) : 800; const h = m ? parseFloat(m[2]) : 500;
  const img = new Image();
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('image render failed')); img.src = url; });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('png encode failed'))), 'image/png'));
}

export async function exportImage(kind: 'svg' | 'png', inner: { svg?: string; imageHref?: string; width: number; height: number }, meta: ImageMeta, name: string, sidecar: Record<string, unknown>, captionText: string, alt: string): Promise<void> {
  const svg = composeExportSVG(inner, meta);
  const base = slugify(name);
  const side = JSON.stringify({ ...sidecar, caption: captionText, alt_text: alt }, null, 2);
  if (kind === 'svg') {
    // SVG carries its provenance inside the file as metadata as well as in the visible footer.
    const withMeta = svg.replace('</svg>', `<metadata>${esc(side)}</metadata></svg>`);
    download(`${base}.zip`, zip([{ name: `${base}.svg`, data: withMeta }, { name: `${base}.provenance.json`, data: side }, { name: `${base}.caption.txt`, data: captionText + '\n\nAlt text: ' + alt + '\n' }]), 'application/zip');
  } else {
    const png = new Uint8Array(await (await svgToPngBlob(svg)).arrayBuffer());
    download(`${base}.zip`, zip([{ name: `${base}.png`, data: png }, { name: `${base}.provenance.json`, data: side }, { name: `${base}.caption.txt`, data: captionText + '\n\nAlt text: ' + alt + '\n' }]), 'application/zip');
  }
}

/** Chart pack for newsrooms: the image as PNG and SVG, a CSV of exactly the plotted values, the caption and the provenance record. */
export async function exportChartPack(inner: { svg?: string; imageHref?: string; width: number; height: number }, meta: ImageMeta, name: string, sidecar: Record<string, unknown>, captionText: string, alt: string, csv: string): Promise<void> {
  const svg = composeExportSVG(inner, meta);
  const base = slugify(name);
  const side = JSON.stringify({ ...sidecar, caption: captionText, alt_text: alt }, null, 2);
  const png = new Uint8Array(await (await svgToPngBlob(svg)).arrayBuffer());
  download(`${base}-chart-pack.zip`, zip([
    { name: `${base}.png`, data: png },
    { name: `${base}.svg`, data: svg.replace('</svg>', `<metadata>${esc(side)}</metadata></svg>`) },
    { name: `${base}.values.csv`, data: csv },
    { name: `${base}.caption.txt`, data: captionText + '\n\n' + (meta.caveatLine ? meta.caveatLine + '\n\n' : '') + 'Alt text: ' + alt + '\n' },
    { name: `${base}.provenance.json`, data: side },
  ]), 'application/zip');
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch { return false; }
  }
}
