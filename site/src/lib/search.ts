/** Site search: plain word-prefix matching over names the site already has in memory. No server, no index file,
 *  nothing typed leaves the browser. Pure functions, so the ranking can be tested. */

export interface SearchItem { kind: 'disease' | 'place' | 'combo' | 'event' | 'page'; label: string; sub?: string; path: string; params?: Record<string, string>; rank: number }
export interface Entry { kind: SearchItem['kind']; label: string; sub?: string; path: string; params?: Record<string, string>; words: string[]; id: string; note?: string }

export function fold(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export function entry(kind: Entry['kind'], id: string, label: string, path: string, extra: string[] = [], sub?: string, params?: Record<string, string>): Entry {
  return { kind, id, label, sub, path, params, words: Array.from(new Set([label, ...extra].flatMap((x) => fold(x).split(' ')).filter(Boolean))) };
}

/** Which query tokens an entry accounts for: a token counts when it is the start of one of the entry's words. */
function hits(tokens: string[], e: Entry): boolean[] {
  return tokens.map((tk) => e.words.some((w) => w.startsWith(tk)));
}
function score(tokens: string[], e: Entry): number {
  const first = fold(e.label).split(' ')[0] ?? '';
  const exact = tokens.filter((tk) => e.words.includes(tk)).length;
  return (first.startsWith(tokens[0]) ? 2 : 0) + exact - e.label.length / 200;
}
const KIND_ORDER: Record<SearchItem['kind'], number> = { combo: 50, disease: 40, place: 30, event: 20, page: 10 };

/** Rank entries for a query. Every token must be matched. A query that names a disease and a place gets a combined
 *  "disease in place" result first, which is what most such searches want. */
export function search(query: string, entries: Entry[], comboLabel: (disease: string, place: string) => string, limit = 8): SearchItem[] {
  const tokens = fold(query).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  const out: SearchItem[] = [];
  const diseases = entries.filter((e) => e.kind === 'disease');
  const places = entries.filter((e) => e.kind === 'place');
  if (tokens.length >= 2) {
    for (const d of diseases) {
      const hd = hits(tokens, d);
      if (!hd.some(Boolean) || hd.every(Boolean)) continue;
      const rest = tokens.filter((_, i) => !hd[i]);
      for (const p of places) {
        if (!hits(rest, p).every(Boolean)) continue;
        out.push({ kind: 'combo', label: comboLabel(d.label, p.label), sub: d.note, path: p.path, params: { d: d.id }, rank: KIND_ORDER.combo + score(tokens.filter((_, i) => hd[i]), d) + score(rest, p) });
      }
    }
  }
  for (const e of entries) {
    if (!hits(tokens, e).every(Boolean)) continue;
    out.push({ kind: e.kind, label: e.label, sub: e.sub, path: e.path, params: e.params, rank: KIND_ORDER[e.kind] + score(tokens, e) });
  }
  return out.sort((a, b) => b.rank - a.rank).slice(0, limit);
}
