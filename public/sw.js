/**
 * Service worker (US-47 / HAD-30).
 *
 * ## This worker deliberately caches almost nothing
 *
 * The usual reason for a service worker is offline-first: cache the shell,
 * serve it instantly, revalidate later. That pattern is wrong here, and wrong
 * in the direction this project cares about most.
 *
 * Every screen in this app is a number someone is making a decision on — how
 * many months of runway they have, what a cheque will cost them, when a legal
 * deadline falls. A cached page shows a figure that was true at some point in
 * the past, with nothing on it saying so. That is the app's signature defect
 * — *a plausible wrong number rather than a visible failure* — served faster
 * and with more confidence.
 *
 * So HTML and data are **never** cached. If the network is gone, the user gets
 * a page that says the network is gone. That is worse UX and better
 * information, and on a screen showing a settlement deadline the information
 * matters more.
 *
 * What is cached is the icon: static, versioned by content, and useless to
 * mislead anybody with.
 *
 * ## Why it exists at all, then
 *
 * Two things need a registered service worker and cannot be had without one:
 *
 * 1. **Web push** (US-16 / D3). Push delivery is routed through this file's
 *    `push` handler; there is no other mechanism.
 * 2. **Installability** to PWA standards, which on iOS is also a precondition
 *    for push existing at all.
 */

const CACHE = 'fintec-static-v1';

/**
 * Only things that cannot go stale in a way that misleads. No HTML, no route
 * data, no API responses — see the note above.
 */
const PRECACHE = ['/icon.svg'];

self.addEventListener('install', (event) => {
  // Take over immediately rather than waiting for every tab to close. A worker
  // held back a version is a worker whose push handler may be the old one.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  /*
   * Everything that is not a precached static asset goes to the network with
   * no fallback, which means the browser's own offline page. Deliberate: a
   * custom "you are offline" shell would be a page this app rendered, and a
   * page this app rendered is one a user could mistake for their data.
   *
   * `event.respondWith` is not called at all for those requests, so the
   * browser handles them exactly as it would with no service worker installed.
   * That is the safest possible behaviour and the easiest to reason about.
   */
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!PRECACHE.includes(url.pathname)) return;

  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request)),
  );
});

/**
 * A funding reminder arriving as push (US-16).
 *
 * The payload is built by the sender and already carries the exact copy US-16
 * specifies. This does not compose a message of its own — a second place that
 * writes reminder text is a second place for it to be wrong, and this one
 * cannot be tested by the unit suite.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  /*
   * A push that arrives unreadable still shows something. The alternative is
   * silence, and silence on this channel is indistinguishable from "no cheque
   * is due" — which is the failure the whole feature exists to prevent. Better
   * a vague notification that makes the user open the app than none.
   */
  const title = payload.title || 'Fund your account';
  const body =
    payload.body ||
    'A cheque or school fee is coming due. Open Readiness to see which and how much.';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      // So a re-sent reminder replaces its predecessor instead of stacking.
      tag: payload.tag || 'fintec-reminder',
      // Cheque reminders should not be dismissed by a passing glance.
      requireInteraction: true,
      data: { url: payload.url || '/calendar/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/calendar/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an open tab rather than opening a second one — someone tapping a
      // cheque reminder wants the app, not another copy of it.
      for (const client of clients) {
        if ('focus' in client) return client.focus().then((c) => c.navigate(target));
      }
      return self.clients.openWindow(target);
    }),
  );
});
