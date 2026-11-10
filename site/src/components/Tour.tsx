/** Guided tours: short scripted walkthroughs (static, translated content; no runtime AI) that run on live site data. */
import { useEffect, useState } from 'preact/hooks';
import { t } from '../lib/i18n';

/** Tour id -> number of steps. Step text lives in the translation files: tour.<id>.s<n>. Each step may point at a selector. */
export const TOURS: Record<string, { steps: { sel?: string }[] }> = {
  epicurve: { steps: [{ sel: '.chart svg' }, { sel: '.chart svg' }, { sel: '[data-testid="chart-subtitle"]' }, { sel: '.legend' }] },
  recentlow: { steps: [{ sel: '[data-testid="incomplete-region"]' }, { sel: '[data-testid="incomplete-note"]' }, { sel: '.tools' }, {}] },
  percapita: { steps: [{ sel: '.tools' }, { sel: '.chart svg' }, { sel: '[data-testid="chart-subtitle"]' }] },
  definitions: { steps: [{ sel: '[data-testid="source-chip"]' }, { sel: '[data-testid="comparability-warning"]' }, { sel: '.legend' }] },
  flag: { steps: [{ sel: '[data-flag]' }, { sel: '[data-flag]' }, { sel: '[data-flag]' }, {}] },
  trace: { steps: [{ sel: '[data-testid="source-chip"]' }, { sel: '[data-testid="source-chip"]' }, { sel: '.btnrow' }] },
};

let listener: ((id: string, scope: string | null) => void) | null = null;
export function startTour(id: string, scopeId?: string): void { listener?.(id, scopeId ?? null); }

export function TourHost() {
  const [state, setState] = useState<{ id: string; scope: string | null; step: number } | null>(null);
  useEffect(() => { listener = (id, scope) => setState({ id, scope, step: 0 }); return () => { listener = null; }; }, []);
  useEffect(() => {
    document.querySelectorAll('.tour-target').forEach((e) => e.classList.remove('tour-target'));
    if (!state) return;
    const sel = TOURS[state.id]?.steps[state.step]?.sel;
    if (!sel) return;
    const root: ParentNode = (state.scope && document.getElementById(state.scope)) || document;
    const el = root.querySelector(sel) ?? document.querySelector(sel);
    if (el) {
      el.classList.add('tour-target');
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      (el as HTMLElement).scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    }
    return () => { el?.classList.remove('tour-target'); };
  }, [state]);
  if (!state) return null;
  const tour = TOURS[state.id];
  const n = tour.steps.length;
  return (
    <div class="tour" role="dialog" aria-label={t('tour.' + state.id + '.title')} aria-live="polite">
      <div class="row"><b>{t('tour.' + state.id + '.title')}</b><span class="small muted">{t('tour.step', { n: state.step + 1, total: n })}</span></div>
      <p>{t(`tour.${state.id}.s${state.step + 1}`)}</p>
      <div class="btnrow">
        <button type="button" class="btn small" disabled={state.step === 0} onClick={() => setState({ ...state, step: state.step - 1 })}>{t('tour.back')}</button>
        {state.step < n - 1
          ? <button type="button" class="btn small primary" onClick={() => setState({ ...state, step: state.step + 1 })}>{t('tour.next')}</button>
          : <button type="button" class="btn small primary" onClick={() => setState(null)}>{t('tour.done')}</button>}
        <button type="button" class="btn small" onClick={() => setState(null)}>{t('action.close')}</button>
      </div>
    </div>
  );
}
