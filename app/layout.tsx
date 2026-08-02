import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';

import { BottomTabs, Sidebar } from '@/components/Shell';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import { LegalFooter } from '@/components/ui';
import './globals.css';

/**
 * The interface font (HAD-65 / NFR-4).
 *
 * ## Why a font ships with this app at all
 *
 * `globals.css` styles with **non-standard weights throughout** — 550 on a stat
 * tile's label, 620 on its value, 640 on the hero number, 650 on the brand and
 * the table totals. Those only resolve as written on a variable font.
 * `system-ui` is SF on Apple platforms, which is variable and does; on Windows
 * it is Segoe UI and on Android it is Roboto, neither of which is variable in
 * the weights installed by default. There the browser snaps to the nearest
 * static weight, so **550 and 620 both land on 600, and 640 and 650 both land
 * on 700** — and the hierarchy the design uses to separate a figure from its
 * caption flattens out.
 *
 * That is not cosmetic here. It is a screen where someone reads AED amounts
 * next to legal dates under stress, and the weight difference is what says
 * which is which without shouting.
 *
 * ## Self-hosted, not a CDN
 *
 * `app/fonts/inter-latin-variable.woff2` is committed, taken from
 * `@fontsource-variable/inter` (SIL OFL, licence alongside it). The package
 * itself is not a dependency — one 48 kB file is the whole need, and a
 * dependency that exists to be copied once is a dependency to keep updated for
 * no reason.
 *
 * A CDN would be a second origin watching page loads on a financial app, and
 * `font-src 'self'` in `lib/security/csp.ts` would refuse it — the e2e suite
 * fails the build on any CSP violation, so that is not a preference, it is a
 * gate.
 *
 * ## The variable axis is the point
 *
 * `weight: '100 900'` declares the whole range, so every value the stylesheet
 * asks for is one the font actually provides. `next/font/local` inlines the
 * `@font-face`, preloads the file and computes a metric-adjusted fallback —
 * which is what keeps CLS at 0 rather than merely under the 0.1 ratchet.
 */
const interVariable = localFont({
  src: './fonts/inter-latin-variable.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-ui',
  // Matched against a real fallback so the swap does not move anything. Without
  // this the fallback renders at its own metrics and the page reflows when the
  // real font arrives — a layout shift on a screen of numbers.
  adjustFontFallback: 'Arial',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'Readiness — finance & termination planning',
  description:
    'Personal finance and termination-readiness planning for a UAE private-sector employee.',
  // Relative so it resolves correctly under a GitHub Pages sub-path.
  manifest: 'manifest.webmanifest',
  applicationName: 'Readiness',
  appleWebApp: { capable: true, title: 'Readiness', statusBarStyle: 'default' },
  // Financial data must never be indexed or cached by a crawler.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f9f9f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0d0d' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AE" className={interVariable.variable}>
      <body>
        <div className="shell">
          <Sidebar />
          <main>{children}</main>
        </div>
        <LegalFooter />
        <BottomTabs />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
