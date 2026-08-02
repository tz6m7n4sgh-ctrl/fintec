/**
 * Next.js configuration.
 *
 * The app runs as a **server build**. It used to be a fully static export for
 * GitHub Pages, and that was fine while it only ever rendered the §11 reference
 * dataset — but a static site has no server boundary, so once real salary,
 * savings and debt figures are involved, row-level security becomes the only
 * thing between that data and the internet. The move restores a boundary, and
 * is what lets auth, the ingestion job and the reminder senders exist at all.
 *
 * `basePath` is kept env-driven so the app can still be mounted under a
 * sub-path if a host needs it. It is empty by default.
 */

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Headers a static host could not set. These are the three the previous
 * configuration named as "restore these if this moves to a host that can set
 * them" — so they are restored.
 *
 * Content-Security-Policy is **not** here, and still should not be — but the
 * reason has changed. It now lives in `middleware.ts`, because the nonce it
 * depends on has to be generated per request and this file is evaluated once at
 * build time. The policy itself is in `lib/security/csp.ts` (HAD-79).
 *
 * The old note said a useful CSP needs per-request nonces rather than
 * `unsafe-inline`, since a CSP with `unsafe-inline` on scripts implies
 * protection it does not provide. That reasoning was correct and is what the
 * middleware implements, rather than something it worked around.
 */
const securityHeaders = [
  // Stop the browser second-guessing declared content types.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // No framing: this app shows financial figures and has no embed use case.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Send the origin cross-site, the full path same-site. Deadline URLs and
  // account pages should not leak into third-party referrer logs.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Nothing here needs a camera, microphone or geolocation.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  basePath,
  assetPrefix: basePath || undefined,

  /**
   * Kept from the export configuration. It is no longer required — a server
   * resolves `/calendar` and `/calendar/` alike — but every existing URL, test
   * and bookmark uses the trailing form, and changing it would turn 164 passing
   * assertions into redirects for no benefit.
   */
  trailingSlash: true,

  /**
   * Server actions default to a 1 MB body, which the backup import (US-45)
   * would quietly exceed.
   *
   * It posts the file twice: once to be counted, and once more as a hidden
   * field on the confirm step. A backup with a few thousand transactions in it
   * is several megabytes, so the default would fail with an opaque "Body
   * exceeded 1mb limit" at exactly the moment somebody is restoring their
   * finances — a limit they never chose, expressed in words about HTTP.
   *
   * 12 MB, against the 10 MB ceiling `MAX_BACKUP_BYTES` states on the screen,
   * leaves room for multipart overhead so the message the user gets is the
   * app's own sentence about their file rather than the framework's about its
   * body size.
   */
  experimental: {
    serverActions: { bodySizeLimit: '12mb' },
  },

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
