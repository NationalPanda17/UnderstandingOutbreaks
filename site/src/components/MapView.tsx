/** MapLibre map (lazy-loaded chunk). Protomaps PMTiles basemap when configured; otherwise boundaries only.
 *  No third-party tile servers, API keys or tracking. Attribution is rendered below the map and baked into exports. */
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 ships its worker as a separate ES module; Vite bundles it into this site's own assets.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef, useState } from 'preact/hooks';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point as turfPoint, polygon as turfPolygon } from '@turf/helpers';
import { SITE, dataUrl } from '../lib/app';
import { locale, smart, t } from '../lib/i18n';

import { DENSITY_RAMP, RAMP, colorFor, quantileBreaks, type MapProps } from './mapUtil';
export { DENSITY_RAMP, RAMP, colorFor, quantileBreaks };
export type { MapPoint, MapProps } from './mapUtil';

maplibregl.setWorkerUrl(workerUrl);
let protocolAdded = false;
async function buildStyle(): Promise<any> {
  const style: any = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e9f0f2' } }] };
  if (SITE.basemapUrl) {
    try {
      const [{ Protocol }, basemaps] = await Promise.all([import('pmtiles'), import('@protomaps/basemaps')]);
      if (!protocolAdded) { maplibregl.addProtocol('pmtiles', new Protocol().tile); protocolAdded = true; }
      style.sources.protomaps = { type: 'vector', url: 'pmtiles://' + SITE.basemapUrl, attribution: '' };
      const glyphs = (SITE as any).basemapGlyphsUrl as string | undefined;
      let layers = (basemaps as any).layers('protomaps', (basemaps as any).namedFlavor('light'), { lang: locale() });
      if (!glyphs) layers = layers.filter((l: any) => l.type !== 'symbol'); else style.glyphs = glyphs;
      if ((SITE as any).basemapSpriteUrl) style.sprite = (SITE as any).basemapSpriteUrl;
      style.layers = layers;
    } catch { /* basemap unavailable: boundaries-only map still works */ }
  }
  return style;
}

function hatch(): ImageData {
  const c = document.createElement('canvas'); c.width = 8; c.height = 8;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, 8, 8);
  g.strokeStyle = '#cfcfcf'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(-2, 10); g.lineTo(10, -2); g.moveTo(-6, 6); g.lineTo(6, -6); g.moveTo(2, 14); g.lineTo(14, 2); g.stroke();
  return g.getImageData(0, 0, 8, 8);
}

/** Dotted fill: the place reports to this source, but nothing has arrived for this period yet. */
function dots(): ImageData {
  const c = document.createElement('canvas'); c.width = 8; c.height = 8;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbf6e6'; g.fillRect(0, 0, 8, 8);
  g.fillStyle = '#b89b3c';
  for (const [x, y] of [[2, 2], [6, 6]]) { g.beginPath(); g.arc(x, y, 1.1, 0, Math.PI * 2); g.fill(); }
  return g.getImageData(0, 0, 8, 8);
}

export default function MapView(props: MapProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number; html: any } | null>(null);
  const [drawing, setDrawing] = useState<[number, number][] | null>(null);
  const latest = useRef(props); latest.current = props;
  const hasBasemap = !!SITE.basemapUrl;
  const ramp = props.ramp ?? RAMP;

  useEffect(() => {
    let dead = false;
    (async () => {
      const style = await buildStyle();
      if (dead || !el.current) return;
      const v = props.view ?? { lng: 15, lat: 18, z: 1.1 };
      const map = new maplibregl.Map({ container: el.current, style, center: [v.lng, v.lat], zoom: v.z, minZoom: 0.5, maxZoom: 9, attributionControl: false, dragRotate: false, pitchWithRotate: false, canvasContextAttributes: { preserveDrawingBuffer: true }, preserveDrawingBuffer: true } as any);
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.keyboard.enable();
      mapRef.current = map;
      map.on('load', () => {
        if (dead) return;
        try { map.addImage('uo-hatch', hatch() as any); map.addImage('uo-dots', dots() as any); } catch { /* image already present */ }
        map.addSource('countries', { type: 'geojson', data: dataUrl('boundaries.geojson'), promoteId: 'iso3' } as any);
        // With a basemap, shaded areas go underneath its place labels so country and city names stay readable.
        const below = map.getStyle().layers?.find((l: any) => l.type === 'symbol')?.id;
        map.addLayer({ id: 'c-fill', type: 'fill', source: 'countries', paint: { 'fill-color': ['to-color', ['coalesce', ['feature-state', 'color'], '#f4f4f4']], 'fill-opacity': ['case', ['boolean', ['feature-state', 'has'], false], hasBasemap ? 0.78 : 1, 0] } } as any, below);
        map.addLayer({ id: 'c-missing', type: 'fill', source: 'countries', paint: { 'fill-pattern': 'uo-hatch', 'fill-opacity': ['case', ['boolean', ['feature-state', 'has'], false], 0, ['boolean', ['feature-state', 'pending'], false], 0, hasBasemap ? 0.6 : 1] } } as any, below);
        map.addLayer({ id: 'c-pending', type: 'fill', source: 'countries', paint: { 'fill-pattern': 'uo-dots', 'fill-opacity': ['case', ['boolean', ['feature-state', 'has'], false], 0, ['boolean', ['feature-state', 'pending'], false], hasBasemap ? 0.7 : 1, 0] } } as any, below);
        map.addLayer({ id: 'c-line', type: 'line', source: 'countries', paint: { 'line-color': '#8fa1a5', 'line-width': 0.6 } }, below);
        map.addLayer({ id: 'c-sel', type: 'line', source: 'countries', paint: { 'line-color': '#17272b', 'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 2.2, 0] } } as any, below);
        map.addSource('lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'l-line', type: 'line', source: 'lines', paint: { 'line-color': '#6a3d9a', 'line-opacity': 0.45, 'line-width': ['get', 'w'], 'line-dasharray': [2, 2] } });
        map.addSource('draw', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'd-fill', type: 'fill', source: 'draw', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#0b6e75', 'fill-opacity': 0.15 } });
        map.addLayer({ id: 'd-line', type: 'line', source: 'draw', paint: { 'line-color': '#0b6e75', 'line-width': 2, 'line-dasharray': [2, 1] } });
        setReady(true);
      });
      map.on('moveend', () => { const c = map.getCenter(); latest.current.onMove?.({ lng: +c.lng.toFixed(2), lat: +c.lat.toFixed(2), z: +map.getZoom().toFixed(2) }); });
      map.on('mousemove', 'c-fill', (e: any) => {
        const f = e.features?.[0]; if (!f) return;
        const p = latest.current; const iso3 = f.properties.iso3;
        const val = p.values?.[iso3];
        map.getCanvas().style.cursor = p.onSelect ? 'pointer' : '';
        setTip({ x: e.point.x, y: e.point.y, html: (<><b>{p.names?.[iso3] ?? f.properties.name}</b><div>{val === null || val === undefined ? (p.missingLabel?.[iso3] ?? t('chart.noData')) : `${p.valueLabel ? p.valueLabel + ': ' : ''}${smart(val)}`}</div>{p.sourceLabel && <div class="muted">{t('map.source')}: {p.sourceLabel}</div>}</>) });
      });
      map.on('mouseleave', 'c-fill', () => { setTip(null); map.getCanvas().style.cursor = ''; });
      map.on('click', (e: any) => {
        const p = latest.current;
        const pts = map.getLayer('p-circle') ? map.queryRenderedFeatures(e.point, { layers: ['p-circle', 'p-cluster'].filter((l) => map.getLayer(l)) }) : [];
        if (pts.length) {
          const f: any = pts[0];
          if (f.properties.cluster) { map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(map.getZoom() + 2, 8) }); return; }
          p.onPoint?.(f.properties.id); return;
        }
        if (drawRef.current) { drawRef.current = [...drawRef.current, [e.lngLat.lng, e.lngLat.lat]]; setDrawing(drawRef.current); return; }
        if (p.onMapClick) { p.onMapClick(e.lngLat.lng, e.lngLat.lat); return; }
        const cf = map.queryRenderedFeatures(e.point, { layers: ['c-fill', 'c-missing', 'c-pending'] });
        if (cf.length && p.onSelect) p.onSelect((cf[0] as any).properties.iso3);
      });
    })();
    return () => { dead = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  // projection: Web Mercator stretches areas far from the equator; the globe does not
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    try { (map as any).setProjection({ type: props.projection === 'globe' ? 'globe' : 'mercator' }); } catch { /* projection not supported: stay on Mercator */ }
  }, [ready, props.projection]);

  // a view passed in after load (a region preset, or a link) moves the map; the user's own panning does not loop back
  const viewKey = props.view ? `${props.view.lng},${props.view.lat},${props.view.z}` : '';
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready || !props.view) return;
    const c = map.getCenter();
    if (Math.abs(c.lng - props.view.lng) < 0.02 && Math.abs(c.lat - props.view.lat) < 0.02 && Math.abs(map.getZoom() - props.view.z) < 0.02) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    map[reduce ? 'jumpTo' : 'easeTo']({ center: [props.view.lng, props.view.lat], zoom: props.view.z } as any);
  }, [ready, viewKey]);

  const drawRef = useRef<[number, number][] | null>(null);
  useEffect(() => { drawRef.current = drawing; }, [drawing]);

  // choropleth values -> feature state
  const applied = useRef<Set<string>>(new Set());
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    const vals = props.values ?? {};
    const breaks = props.breaks ?? quantileBreaks(Object.values(vals).filter((x): x is number => typeof x === 'number'));
    const apply = () => {
      const miss = props.missing ?? {};
      const ids = new Set([...Object.keys(vals), ...Object.keys(miss), ...applied.current]);
      ids.forEach((iso3) => {
        const c = colorFor(vals[iso3], breaks, ramp);
        map.setFeatureState({ source: 'countries', id: iso3 }, { color: c ?? '#f4f4f4', has: c !== null, pending: c === null && miss[iso3] === 'pending', sel: !!props.selected?.includes(iso3) });
      });
      (props.selected ?? []).forEach((iso3) => { if (!ids.has(iso3)) map.setFeatureState({ source: 'countries', id: iso3 }, { sel: true }); ids.add(iso3); });
      applied.current = ids;
    };
    if (map.isSourceLoaded('countries')) apply(); else { const on = (e: any) => { if (e.sourceId === 'countries' && map.isSourceLoaded('countries')) { apply(); map.off('sourcedata', on); } }; map.on('sourcedata', on); }
  }, [ready, props.values, props.missing, props.breaks, (props.selected ?? []).join(',')]);

  // points / clusters / heat
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    for (const l of ['p-heat', 'p-cluster', 'p-ring', 'p-circle']) if (map.getLayer(l)) map.removeLayer(l);
    if (map.getSource('points')) map.removeSource('points');
    const pts = props.points ?? [];
    if (!pts.length) return;
    const mode = props.pointMode ?? 'markers';
    const srcIds = Array.from(new Set(pts.flatMap((p) => p.sources)));
    const clusterProperties: Record<string, any> = {};
    srcIds.forEach((s) => { clusterProperties['s_' + s] = ['+', ['case', ['in', s, ['get', 'src']], 1, 0]]; });
    map.addSource('points', {
      type: 'geojson', cluster: mode === 'clusters', clusterRadius: 40, clusterMaxZoom: 6, clusterProperties,
      data: { type: 'FeatureCollection', features: pts.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { id: p.id, label: p.label, precision: p.precision ?? '', src: p.sources.join(','), w: p.weight ?? 1, color: p.color ?? '#7a5c00', r: p.radius ?? 6, sub: p.sub ?? '' } })) },
    } as any);
    if (mode === 'heat') {
      map.addLayer({ id: 'p-heat', type: 'heatmap', source: 'points', paint: { 'heatmap-weight': ['get', 'w'], 'heatmap-radius': 24, 'heatmap-opacity': 0.75, 'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(255,255,204,0)', 0.2, '#c7e9b4', 0.4, '#7fcdbb', 0.6, '#41b6c4', 0.8, '#225ea8', 1, '#0c2c84'] } } as any);
    } else {
      if (mode === 'clusters') map.addLayer({ id: 'p-cluster', type: 'circle', source: 'points', filter: ['has', 'point_count'], paint: { 'circle-color': '#7a5c00', 'circle-opacity': 0.85, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-radius': ['step', ['get', 'point_count'], 12, 5, 16, 15, 21, 40, 27] } } as any);
      // A wide, faint ring says how roughly the notice locates the event: the wider the ring, the vaguer the place.
      map.addLayer({ id: 'p-ring', type: 'circle', source: 'points', filter: ['all', ['!', ['has', 'point_count']], ['in', ['get', 'precision'], ['literal', ['country', 'admin1']]]], paint: { 'circle-color': ['to-color', ['get', 'color']], 'circle-opacity': 0.07, 'circle-stroke-color': ['to-color', ['get', 'color']], 'circle-stroke-opacity': 0.35, 'circle-stroke-width': 0.8, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, ['case', ['==', ['get', 'precision'], 'country'], 9, 7], 6, ['case', ['==', ['get', 'precision'], 'country'], 44, 20]] } } as any);
      map.addLayer({ id: 'p-circle', type: 'circle', source: 'points', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': ['to-color', ['get', 'color']], 'circle-radius': ['get', 'r'], 'circle-opacity': 0.88, 'circle-stroke-color': '#fff', 'circle-stroke-width': ['case', ['==', ['get', 'precision'], 'country'], 2.5, 1], 'circle-stroke-opacity': 1 } } as any);
      const over = (e: any) => {
        const f = e.features?.[0]; if (!f) return;
        map.getCanvas().style.cursor = 'pointer';
        if (f.properties.cluster) {
          const names = srcIds.filter((s) => f.properties['s_' + s] > 0);
          setTip({ x: e.point.x, y: e.point.y, html: (<><b>{t('map.cluster', { n: f.properties.point_count })}</b><div class="muted">{t('map.source')}: {names.map((s) => latest.current.names?.['src:' + s] ?? s).join(', ')}</div></>) });
        } else {
          setTip({ x: e.point.x, y: e.point.y, html: (<><b>{f.properties.label}</b>{f.properties.sub && <div>{f.properties.sub}</div>}{f.properties.precision && <div>{t('map.precision')}: {t('precision.' + f.properties.precision)}</div>}<div class="muted">{t('map.source')}: {String(f.properties.src).split(',').map((s: string) => latest.current.names?.['src:' + s] ?? s).join(', ')}</div></>) });
        }
      };
      const out = () => { setTip(null); map.getCanvas().style.cursor = ''; };
      map.on('mousemove', 'p-circle', over); map.on('mouseleave', 'p-circle', out);
      if (mode === 'clusters') { map.on('mousemove', 'p-cluster', over); map.on('mouseleave', 'p-cluster', out); }
    }
  }, [ready, props.points, props.pointMode]);

  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    (map.getSource('lines') as any)?.setData({ type: 'FeatureCollection', features: (props.lines ?? []).map((l) => ({ type: 'Feature', properties: { w: l.w }, geometry: { type: 'LineString', coordinates: [l.from, l.to] } })) });
  }, [ready, props.lines]);

  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    const d = drawing ?? [];
    const feats: any[] = [];
    if (d.length >= 2) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: d } });
    if (d.length >= 3) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...d, d[0]]] } });
    (map.getSource('draw') as any)?.setData({ type: 'FeatureCollection', features: feats });
  }, [ready, drawing]);

  useEffect(() => {
    if (!props.apiRef) return;
    props.apiRef.current = {
      image: () => mapRef.current?.getCanvas().toDataURL('image/png') ?? '',
      size: () => ({ width: el.current?.clientWidth ?? 800, height: el.current?.clientHeight ?? 460 }),
    };
  }, [ready]);

  const finishRegion = () => {
    const d = drawing ?? [];
    if (d.length >= 3 && props.onRegion && props.centroids) {
      const poly = turfPolygon([[...d, d[0]]]);
      const inside = Object.entries(props.centroids).filter(([, c]) => c && booleanPointInPolygon(turfPoint(c), poly)).map(([k]) => k);
      props.onRegion(inside);
    }
    setDrawing(null);
  };

  return (
    <div>
      {props.onRegion && (
        <div class="btnrow" style={{ marginBottom: '6px' }}>
          {!drawing && <button type="button" class="btn small" onClick={() => setDrawing([])}>{t('map.draw')}</button>}
          {drawing && <><span class="small">{t('map.drawHint', { n: drawing.length })}</span><button type="button" class="btn small primary" disabled={drawing.length < 3} onClick={finishRegion}>{t('map.drawFinish')}</button><button type="button" class="btn small" onClick={() => setDrawing(null)}>{t('action.cancel')}</button></>}
        </div>
      )}
      <div class={'map' + (props.tall ? ' tall' : '')} role="application" aria-label={props.ariaLabel}>
        <div ref={el} style={{ position: 'absolute', inset: 0 }} />
        {tip && <div class="tip" style={{ left: Math.min(tip.x + 12, (el.current?.clientWidth ?? 600) - 220) + 'px', top: tip.y + 12 + 'px' }}>{tip.html}</div>}
      </div>
      <p class="mapattr" data-testid="map-attribution">{t('map.attr.boundaries')}{hasBasemap ? ' ' + t('map.attr.basemap') : ''}{props.values ? ' ' + t('map.attr.population') : ''}{props.points?.length ? ' ' + t('map.attr.gazetteer') : ''}</p>
    </div>
  );
}

