'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker (US-47 / HAD-30).
 *
 * A component rather than an inline `<script>` because the CSP forbids inline
 * script without a nonce, and threading a nonce through the layout to run three
 * lines is more moving parts than a component that React already knows how to
 * hydrate.
 *
 * It renders nothing and it fails silently on purpose. A service worker is not
 * load-bearing for any figure on any screen — it buys installability and a
 * push channel — so a browser that refuses to register one (private mode,
 * an unsupported engine, an http origin) should get the app working normally
 * rather than an error about a feature they were not using.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    /*
     * `sw.js` is served from `public/`, so the base path has to be applied by
     * hand — Next only does that for `next/link` and `next/image`. Under a
     * sub-path deployment a bare '/sw.js' would 404, and the e2e suite fails
     * the build on any 404, which is how that would be caught.
     */
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

    navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` }).catch(() => {
      // Deliberately quiet. See above — and a console.error here would fail the
      // e2e suite, which treats any console error as a defect.
    });
  }, []);

  return null;
}
