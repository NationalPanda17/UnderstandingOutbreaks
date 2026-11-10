/** In-browser notebooks. Everything runs locally in the browser; runtimes are self-hosted and loaded only on request.
 *  - Python: JupyterLite (Pyodide), embedded from this site's own tool assets when installed.
 *  - R: webR, with a simple run-and-see console.
 *  Starter notebooks can always be downloaded as .ipynb / .qmd, with or without a runtime. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { SITE } from '../lib/app';
import { num, t } from '../lib/i18n';
import { Loading, useAsync } from '../components/Layout';

interface NbIndex { notebooks: { id: string; title: string; language: 'python' | 'r'; ipynb?: string; qmd?: string; script?: string; description: string }[] }

export function Notebooks() {
  const idx = useAsync(() => fetch('/notebooks/index.json').then((r) => r.json() as Promise<NbIndex>), []);
  const tools = useAsync(() => fetch(SITE.toolAssetsBaseUrl + '/manifest.json').then((r) => r.json()).catch(() => ({ tools: {} })), []);
  const [lite, setLite] = useState(false);
  const small = typeof window !== 'undefined' && window.innerWidth < 720;
  const liteInstalled = !!tools.data?.tools?.jupyterlite?.installed;
  const webrBytes = tools.data?.tools?.webr?.bytes as number | undefined;
  return (
    <>
      <h2>{t('nb.title')}</h2>
      <p class="muted">{t('nb.lead')}</p>
      {small && <div class="notice warn" role="note" data-testid="small-screen">{t('workbench.smallScreen')}</div>}
      <section class="card">
        <h3>{t('nb.starters')}</h3>
        {idx.loading && <Loading />}
        <ul class="list">
          {(idx.data?.notebooks ?? []).map((n) => (
            <li key={n.id}><b>{n.title}</b> <span class="badge">{n.language === 'python' ? 'Python' : 'R'}</span>
              <div class="small muted">{n.description}</div>
              <div class="btnrow">
                {n.ipynb && <a class="btn small" href={`/notebooks/${n.ipynb}`} download>{t('nb.downloadIpynb')}</a>}
                {n.qmd && <a class="btn small" href={`/notebooks/${n.qmd}`} download>{t('nb.downloadQmd')}</a>}
              </div></li>
          ))}
        </ul>
        <p class="small muted">{t('nb.env')} <a href="/notebooks/requirements.txt">requirements.txt</a> · <a href="/notebooks/renv-packages.R">renv-packages.R</a></p>
      </section>
      <section class="card" style={{ marginTop: '16px' }}>
        <h3>Python · JupyterLite</h3>
        {!liteInstalled && <div class="notice" role="note">{t('nb.liteMissing')}</div>}
        {liteInstalled && !lite && <button type="button" class="btn primary" onClick={() => setLite(true)}>{t('nb.liteOpen')}</button>}
        {liteInstalled && lite && <iframe title="JupyterLite" src={`${SITE.toolAssetsBaseUrl}/jupyterlite/lab/index.html`} style={{ width: '100%', height: '720px', border: '1px solid var(--line)', borderRadius: '8px' }} referrerpolicy="no-referrer" />}
        <p class="small muted">{t('nb.local')}</p>
      </section>
      <section class="card" style={{ marginTop: '16px' }}>
        <h3>R · webR</h3>
        {webrBytes ? <RConsole size={webrBytes} script={(idx.data?.notebooks ?? []).find((n) => n.language === 'r' && n.script)?.script} /> : <div class="notice" role="note">{t('nb.webrMissing')}</div>}
      </section>
    </>
  );
}

function RConsole({ size, script }: { size: number; script?: string }) {
  const [code, setCode] = useState('');
  const [out, setOut] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'running' | 'error'>('idle');
  const webr = useRef<any>(null);
  useEffect(() => { if (script) fetch(`/notebooks/${script}`).then((r) => r.text()).then((s) => setCode(s.replace(/BASE <- ".*"/, `BASE <- "${window.location.origin}${SITE.dataPath}"`))).catch(() => undefined); }, [script]);
  const run = async () => {
    try {
      if (!webr.current) {
        setState('loading');
        // Same origin on purpose (see scripts/postbuild.mjs): the dev server has it under /r2/tools, production under /tools.
        const base = new URL(import.meta.env.DEV ? '/r2/tools/webr/' : '/tools/webr/', window.location.href).href;
        const mod = await import(/* @vite-ignore */ base + 'webr.js'); // the browser build; webr.mjs is for Node and imports "module"
        const w = new mod.WebR({ baseUrl: base, channelType: mod.ChannelType.PostMessage });
        await w.init();
        webr.current = w;
      }
      setState('running');
      const shelter = await new webr.current.Shelter();
      try {
        const res = await shelter.captureR(code, { withAutoprint: true, captureStreams: true, captureConditions: false });
        setOut(res.output.map((o: any) => (typeof o.data === 'string' ? o.data : '')).join('\n'));
      } finally { await shelter.purge(); }
      setState('ready');
    } catch (e: any) { setOut(String(e?.message ?? e)); setState('error'); }
  };
  return (
    <>
      <label for="r-code" class="small muted">{t('nb.rCode')}</label>
      <textarea id="r-code" rows={14} value={code} spellcheck={false} style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: '.85rem' }} onInput={(e) => setCode((e.target as HTMLTextAreaElement).value)} />
      <div class="btnrow">
        <button type="button" class="btn primary" onClick={run} disabled={state === 'loading' || state === 'running'}>{state === 'idle' ? t('nb.rLoad', { size: num(size / 1048576, { maximumFractionDigits: 0 }) }) : t('sql.run')}</button>
        {(state === 'loading' || state === 'running') && <span role="status" class="small">{state === 'loading' ? t('nb.rLoading') : t('sql.running')}</span>}
      </div>
      {out && <pre aria-live="polite" style={{ maxHeight: '360px', whiteSpace: 'pre-wrap' }}>{out}</pre>}
      <p class="small muted">{t('nb.local')}</p>
    </>
  );
}
