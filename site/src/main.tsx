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
import { About, Changelog, Changes, Cite, GlossaryPage, Methodology, Quality, ReportersGuide, Researchers, SourceStatus, Sources } from './pages/InfoPages';
import { MapPage } from './pages/MapPage';
import { Outbreak, Outbreaks, StoryKit } from './pages/OutbreakPages';
import { Overview } from './pages/Overview';
import { Place } from './pages/Place';
import { Accessibility, Briefing, CorrectionsPolicy, EditorialStandards, NotFound, Privacy } from './pages/Policies';
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
    case 'outbreak': return parts[2] === 'kit' ? <StoryKit id={b} /> : <Outbreak id={b} />;
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
    case 'status': return <SourceStatus />;
    case 'privacy': return <Privacy />;
    case 'accessibility': return <Accessibility />;
    case 'corrections': return <CorrectionsPolicy />;
    case 'editorial-standards': return <EditorialStandards />;
    case 'briefing': return <Briefing key={'br' + (b ?? '')} week={b} />;
    case 'compare': return <Lazy key="cmp" load={() => import('./workbench/ComparePlain')} parts={parts.slice(1)} />;
    case 'spread': return <Lazy key={'sp' + (parts[1] ?? '')} load={() => import('./pages/Spread')} parts={parts.slice(1)} />;
    case 'workbench': return <Lazy key="wb" load={() => import('./workbench/index')} parts={parts.slice(1)} />;
    case 'learn': return <Lazy key="learn" load={() => import('./sim/ui/index')} parts={parts.slice(1)} />;
    default: return <NotFound />;
  }
}

function App() {
  const route = useRoute();
  const [core, setCore] = useState<Core | null>(null);
  const [ready, setReady] = useState('');
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { loadCore().then(setCore).catch(setErr); }, []);
  useEffect(() => { loadLocale(route.locale).then(() => { setReady(route.locale); storage.set('locale', route.locale); }); }, [route.locale]);
  useEffect(() => { if (core && ready === route.locale) document.getElementById('static')?.remove(); }, [core, ready, route.locale]);
  useEffect(() => {
    if (!ready) return;
    const key = 'title.' + (route.parts[0] ?? 'overview');
    const page = t(key);
    const generic = !route.parts[0] ? `${SITE.name}: ${t('title.homeTag')}` : (page === key ? '' : page + ' · ') + SITE.name;
    document.title = generic;
    // The tab, the history entry and a bookmark name the page itself ("Kenya", "Measles", an outbreak), taken from
    // its heading once the data has arrived. The home page keeps the site's name first.
    if (!route.parts[0]) return;
    const main = document.getElementById('main'); if (!main) return;
    const name = () => { const h = main.querySelector('h1')?.textContent?.trim(); if (h) document.title = `${h} · ${SITE.name}`; };
    name();
    const obs = new MutationObserver(name);
    obs.observe(main, { childList: true, subtree: true, characterData: true });
    return () => obs.disconnect();
  }, [ready, core, route.parts.join('/')]);
  if (err) return <div class="wrap"><ErrorBox error={err} /></div>;
  // A pre-built page already shows its headline content as plain HTML (#static, written at build time). It stays
  // until the app has its data, then gives way to the app; a page without it shows the usual placeholder.
  if (!core || ready !== route.locale) return document.getElementById('static') ? null : <div class="wrap"><Loading /></div>;
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
