/**
 * Next.js configuration.
 *
 * The app is exported as a fully static site so it can be hosted on GitHub
 * Pages. Every route is prerendered at build time — there is no server at
 * runtime — which works because the read model is resolved during the build.
 * When live Supabase data arrives it will be fetched client-side, protected by
 * row-level security rather than by a server boundary.
 *
 * GitHub Pages serves a project site from a sub-path
 * (`<user>.github.io/<repo>/`), so `basePath` must match the repository name.
 * It is read from the environment so local development stays at `/`.
 */

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Static HTML export — output lands in `out/`.
  output: 'export',

  basePath,
  assetPrefix: basePath || undefined,

  /**
   * Emit `route/index.html` rather than `route.html`. GitHub Pages does no
   * extension rewriting, so without this `/calendar` would 404 and only
   * `/calendar.html` would resolve.
   */
  trailingSlash: true,

  // There is no image optimisation server in an export.
  images: { unoptimized: true },

  /**
   * Security headers are deliberately absent rather than misleadingly present.
   * `headers()` needs a server, is ignored by `output: 'export'`, and GitHub
   * Pages cannot set response headers at all — so a headers block here would
   * imply protection that does not exist. If this moves to a host that can set
   * them (Vercel, Netlify, a Node server), restore X-Content-Type-Options,
   * X-Frame-Options and Referrer-Policy there.
   */
};

export default nextConfig;
