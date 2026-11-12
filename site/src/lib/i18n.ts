/** Internationalisation: externalised strings, ICU MessageFormat, Intl-based formatting, RTL-ready.
 *
 * Adding a language = one JSON file in src/i18n/locales plus one line in config/site.json. No code changes.
 */
import { IntlMessageFormat } from 'intl-messageformat';
import { SITE } from './app';

type Messages = Record<string, string>;
const loaders = import.meta.glob('../i18n/locales/*.json') as Record<string, () => Promise<{ default: Messages }>>;
const cache = new Map<string, Messages>();
const fmtCache = new Map<string, IntlMessageFormat>();
let current = SITE.defaultLocale;
let fallback: Messages = {};

export async function loadLocale(locale: string): Promise<void> {
  const want = [SITE.defaultLocale, locale];
  for (const l of new Set(want)) {
    if (!cache.has(l)) {
      const loader = loaders[`../i18n/locales/${l}.json`];
      cache.set(l, loader ? (await loader()).default : {});
    }
  }
  fallback = cache.get(SITE.defaultLocale) ?? {};
  current = locale;
  const meta = SITE.locales.find((x) => x.code === locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = meta?.dir ?? 'ltr';
}

export function locale(): string { return current; }

export function hasKey(key: string): boolean {
  return key in (cache.get(current) ?? {}) || key in fallback;
}

/** Translate. Falls back to the default locale, then to the key itself (visible, so gaps get noticed). */
export function t(key: string, vars?: Record<string, unknown>): string {
  const msgs = cache.get(current) ?? {};
  const msg = msgs[key] ?? fallback[key];
  if (msg === undefined) return key;
  if (!vars && !msg.includes('{')) return msg;
  const ck = `${msgs[key] !== undefined ? current : SITE.defaultLocale}|${key}`;
  let f = fmtCache.get(ck);
  if (!f) {
    try { f = new IntlMessageFormat(msg, msgs[key] !== undefined ? current : SITE.defaultLocale); } catch { return msg; }
    fmtCache.set(ck, f);
  }
  try { return String(f.format(vars as Record<string, any>)); } catch { return msg; }
}

const nf = new Map<string, Intl.NumberFormat>();
export function num(v: number | null | undefined, opts: Intl.NumberFormatOptions = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  const k = current + JSON.stringify(opts);
  let f = nf.get(k);
  if (!f) { f = new Intl.NumberFormat(current, { maximumFractionDigits: 2, ...opts }); nf.set(k, f); }
  return f.format(v);
}

/** Compact, readable number: 2 significant decimals for small rates, none for counts. */
export function smart(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  const a = Math.abs(v);
  if (a !== 0 && a < 1) return num(v, { maximumSignificantDigits: 2 });
  if (a < 100) return num(v, { maximumFractionDigits: 1 });
  return num(v, { maximumFractionDigits: 0 });
}

export function date(iso: string | null | undefined, style: 'medium' | 'long' | 'short' = 'medium'): string {
  if (!iso) return '–';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(current, { dateStyle: style, timeZone: 'UTC' }).format(d);
}

/** A period inside a sentence: "the week of Oct 5, 2026", "Aug 2026", "2024". */
export function periodInSentence(period: string, ptype: string): string {
  return ptype === 'W' ? t('period.weekOfIn', { date: date(period) }) : periodLabel(period, ptype);
}

/** A snapshot id (a UTC timestamp such as 20261112T001709Z) as a readable date and time. Readers never need the raw id. */
export function snapLabel(id: string | null | undefined): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(id ?? '');
  return m ? `${date(`${m[1]}-${m[2]}-${m[3]}`)}, ${m[4]}:${m[5]} UTC` : (id ?? '');
}

export function periodLabel(period: string, ptype: string): string {
  const d = new Date(period + 'T00:00:00Z');
  if (ptype === 'Y') return String(d.getUTCFullYear());
  if (ptype === 'M') return new Intl.DateTimeFormat(current, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
  return t('period.weekOf', { date: date(period) });
}

let regionNames: Intl.DisplayNames | null = null;
let regionLocale = '';
/** Country name in the viewer's language via Intl; falls back to the source's English name. */
/** Plain names where the standard list reads like a database field ("Congo - Kinshasa", "Myanmar (Burma)"). */
const PLAIN_NAMES: Record<string, Record<string, string>> = {
  en: { CD: 'DR Congo', CG: 'Republic of the Congo', MM: 'Myanmar', HK: 'Hong Kong', MO: 'Macao' },
  es: { CD: 'RD del Congo', CG: 'República del Congo', MM: 'Myanmar', HK: 'Hong Kong', MO: 'Macao' },
  fr: { CD: 'RD Congo', CG: 'République du Congo', MM: 'Myanmar', HK: 'Hong Kong', MO: 'Macao' },
  de: { CD: 'DR Kongo', CG: 'Republik Kongo', MM: 'Myanmar', HK: 'Hongkong', MO: 'Macau' },
};

export function countryName(iso2: string | undefined, fallbackName: string): string {
  if (!iso2) return fallbackName;
  const plain = PLAIN_NAMES[current.slice(0, 2)]?.[iso2];
  if (plain) return plain;
  try {
    if (!regionNames || regionLocale !== current) { regionNames = new Intl.DisplayNames([current], { type: 'region' }); regionLocale = current; }
    return regionNames.of(iso2) ?? fallbackName;
  } catch { return fallbackName; }
}
