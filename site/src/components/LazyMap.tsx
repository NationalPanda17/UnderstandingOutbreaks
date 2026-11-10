/** Loads the MapLibre chunk only when a map is actually shown, so pages without maps stay light. */
import { useEffect, useState } from 'preact/hooks';
import { t } from '../lib/i18n';
import type { MapProps } from './mapUtil';

export function LazyMap(props: MapProps) {
  const [Comp, setComp] = useState<any>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { let live = true; import('./MapView').then((m) => { if (live) setComp(() => m.default); }).catch(() => setErr(true)); return () => { live = false; }; }, []);
  if (err) return <div class="notice warn" role="alert">{t('map.failed')}</div>;
  if (!Comp) return <div class={'map' + (props.tall ? ' tall' : '')} role="status">{t('state.loadingMap')}</div>;
  return <Comp {...props} />;
}
