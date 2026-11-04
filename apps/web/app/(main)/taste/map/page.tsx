'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { FlowerSpinner } from '../../../../components/sj/Loading';
import { supabase } from '../../../../lib/supabaseClient';
import { setDevToken } from '../../../../lib/tasteMap/client';
import { MOCK_TASTE_MAP } from '../../../../lib/tasteMap/mockPayload';
import type { TasteMapPayload } from '../../../../lib/tasteMap/types';

/**
 * /taste/map — DEV-ONLY preview of the Taste Map (TASTE_MAP_PLAN.md Phase 2),
 * fed by `GET /api/taste/map`; `?mock=1` renders the fixed mock payload instead
 * (no login needed). Intentionally unlinked: nothing in the app points here yet
 * (the "Open map" entry on TasteGraph comes once Jun has signed off on the real
 * layout). The viewer is loaded with `ssr: false`, so three.js and the canvas
 * code only ship on this route.
 *
 * Writes (autosave of pins / layout, export, import) only run with a real
 * session: in `?mock=1` and `?fixture=` mode the view is local-only. Group
 * edits then stay in memory; eras, weights and Add artist need the server.
 * Dev only: `?fixture=…&api=1` sends the Phase 4 calls anyway (with a stand-in
 * token, client.ts setDevToken) so a playwright run can intercept them.
 */
const TasteMapView = dynamic(() => import('../../../../components/sj/tasteMap/TasteMapView'), {
  ssr: false,
  loading: () => <Centered><FlowerSpinner /></Centered>,
});

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-[60vh] items-center justify-center text-sm text-muted">{children}</div>;
}

type State = { kind: 'loading' } | { kind: 'ready'; payload: TasteMapPayload } | { kind: 'error'; message: string };

export default function TasteMapPage() {
  return (
    <Suspense>
      <TasteMapLoader />
    </Suspense>
  );
}

function TasteMapLoader() {
  const params = useSearchParams();
  const mock = params.get('mock') === '1';
  const refresh = params.get('refresh') === '1';
  // Dev only: render a payload from a URL (e.g. one written by
  // scripts/dump-taste-map-layout.ts --out) so any user's map can be inspected
  // without their session. Ignored in production builds.
  const fixture = process.env.NODE_ENV === 'development' ? params.get('fixture') : null;
  const [state, setState] = useState<State>(mock ? { kind: 'ready', payload: MOCK_TASTE_MAP } : { kind: 'loading' });
  // Bumped to re-fetch (after an import); also remounts the view on the fresh payload.
  const [reloadNonce, setReloadNonce] = useState(0);
  // The next reload asks the server to re-solve (?refresh=1), e.g. after new map weights.
  const refreshNext = useRef(false);
  const persist = !mock && !fixture;
  const devApi = process.env.NODE_ENV === 'development' && !persist && params.get('api') === '1';
  const api = persist || devApi;
  useEffect(() => {
    setDevToken(devApi ? 'dev-fixture' : null);
  }, [devApi]);

  useEffect(() => {
    if (mock) return;
    let cancelled = false;
    if (reloadNonce > 0) setState({ kind: 'loading' });
    (async () => {
      if (fixture) {
        const res = await fetch(fixture);
        if (!res.ok) throw new Error(`fixture ${res.status}`);
        return (await res.json()) as TasteMapPayload;
      }
      if (!supabase) throw new Error('not configured');
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sign in to see your taste map.');
      const wantRefresh = (refresh && reloadNonce === 0) || refreshNext.current;
      refreshNext.current = false;
      const res = await fetch(`/api/taste/map${wantRefresh ? '?refresh=1' : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 422) {
        const body = await res.json();
        throw new Error(`Rate at least ${body.needed} albums to build your map (you have ${body.have}).`);
      }
      if (!res.ok) throw new Error(`taste map ${res.status}`);
      return (await res.json()) as TasteMapPayload;
    })()
      .then((payload) => !cancelled && payload && setState({ kind: 'ready', payload }))
      .catch((e: Error) => !cancelled && setState({ kind: 'error', message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [mock, refresh, fixture, reloadNonce]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
      {state.kind === 'loading' && <Centered><FlowerSpinner /></Centered>}
      {state.kind === 'error' && <Centered>{state.message}</Centered>}
      {state.kind === 'ready' && (
        <TasteMapView
          key={reloadNonce}
          payload={state.payload}
          persist={persist}
          api={api}
          onReload={
            api
              ? (opts?: { refresh?: boolean }) => {
                  refreshNext.current = !!opts?.refresh;
                  setReloadNonce((n) => n + 1);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
