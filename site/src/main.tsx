/** Main site entry. Heavy sections (map, workbench, simulation sandbox) are separate lazily-loaded chunks. */
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles/main.css';
import { SITE, applyRemembered, installLinkHandler, storage, useRoute } from './lib/app';
import { loadCore, type Core } from './lib/data';
import { loadLocale, t } from './lib/i18n';
import { ErrorBox, Layout, Loading } from './components/Layout';
import { AppCtx } from './components/SourceChip';
import { TourHost } from './components/Tour';
import { DiseasePage, Diseases } from './pages/DiseasePages';
import { Explorer } from './pages/Explorer';
import { About, Changelog, Changes, Cite, GlossaryPage, Methodology, Quality, ReportersGuide, Researchers, Sources } from './pages/InfoPages';
import { MapPage } from './pages/MapPage';
import { Outbreak, Outbreaks } from './pages/OutbreakPages';
import { Overview } from './pages/Overview';
import { Place } from './pages/Place';
import { Watchlists } from './pages/Watchlists';

function Lazy({ load, parts }: { load: () => Promise<{ default: any }>; parts: string[] }) {
  const [C, setC] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { let live = true; load().then((m) => live && setC(() => m.default)).catch(setErr); return () => { live = false; }; }, []);
  if (err) return <ErrorBox error={err} />;
  return C ? <C parts={parts} /> : <Loading />;
}

function Page({ parts }: { parts: string[] }) {
  const [a, b] = parts;
  switch (a ?? '') {
    case '': return <Overview />;
    case 'diseases': return <Diseases />;
    case 'disease': return <DiseasePage id={b} />;
    case 'place': return <Place iso3={(b ?? '').toUpperCase()} />;
    case 'outbreaks': return <Outbreaks />;
    case 'outbreak': return <Outbreak id={b} />;
    case 'map': return <MapPage />;
    case 'explorer': return <Explorer />;
    case 'changes': return <Changes />;
    case 'data-quality': return <Quality />;
    case 'changelog': return <Changelog />;
    case 'methodology': return <Methodology />;
    case 'about': return <About />;
    case 'glossary': return <GlossaryPage />;
    case 'reporters-guide': return <ReportersGuide />;
    case 'sources': return <Sources />;
    case 'cite': return <Cite />;
    case 'researchers': return <Researchers />;
    case 'watchlists': return <Watchlists />;
    case 'compare': return <Lazy key="cmp" load={() => import('./workbench/ComparePlain')} parts={parts.slice(1)} />;
    case 'workbench': return <Lazy key="wb" load={() => import('./workbench/index')} parts={parts.slice(1)} />;
    case 'learn': return <Lazy key="learn" load={() => import('./sim/ui/index')} parts={parts.slice(1)} />;
    default: return <div class="notice warn" role="alert">{t('state.notFound')}</div>;
  }
}

function App() {
  const route = useRoute();
  const [core, setCore] = useState<Core | null>(null);
  const [ready, setReady] = useState('');
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { loadCore().then(setCore).catch(setErr); }, []);
  useEffect(() => { loadLocale(route.locale).then(() => { setReady(route.locale); storage.set('locale', route.locale); }); }, [route.locale]);
  useEffect(() => {
    if (!ready) return;
    const key = 'title.' + (route.parts[0] ?? 'overview');
    const page = t(key);
    document.title = (page === key ? '' : page + ' · ') + SITE.name;
  }, [ready, route.parts.join('/')]);
  if (err) return <div class="wrap"><ErrorBox error={err} /></div>;
  if (!core || ready !== route.locale) return <div class="wrap"><p role="status">Loading…</p></div>;
  return (
    <AppCtx.Provider value={{ core, route }}>
      <Layout><Page parts={route.parts} /></Layout>
      <TourHost />
    </AppCtx.Provider>
  );
}

applyRemembered();
installLinkHandler();
render(<App />, document.getElementById('app')!);
