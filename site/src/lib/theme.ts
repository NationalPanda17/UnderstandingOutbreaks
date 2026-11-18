/** One visual style for every chart, map label and exported image, so they read as one publication.
 *  The typeface is the site's own (served from this site); an exported image falls back to the reader's system
 *  face, because a downloaded file cannot carry the web font. */
export const FONT = "'Inter Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
export const CHART = {
  ink: '#17272b',      // titles, emphasised marks
  axis: '#4a5b5f',     // axis labels and tick text
  rule: '#9aa8ab',     // axis lines and tick marks
  grid: '#e6ecee',     // horizontal grid lines
  accent: '#0b6e75',   // the single-series colour (sparklines, notice dots, timeline bars)
  note: '#7a5c00',     // flag markers and annotations
  paper: '#ffffff',
  text: 12,            // axis and tick text, in SVG units
  small: 11,           // in-plot annotations
} as const;
/** The brand mark as SVG markup, for exported images. The page header draws the same shape. */
export const MARK_PATH = 'M5 22c4 0 4-12 8-12s4 8 7 8 3-4 7-4';
export function markSvg(x: number, y: number, size: number): string {
  const k = size / 32;
  return `<g transform="translate(${x} ${y}) scale(${k})"><rect width="32" height="32" rx="7" fill="${CHART.accent}"/><path d="${MARK_PATH}" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="27" cy="14" r="2.4" fill="#fff"/></g>`;
}
