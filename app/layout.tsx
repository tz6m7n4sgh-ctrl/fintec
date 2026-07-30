import type { Metadata, Viewport } from 'next';

import { BottomTabs, Sidebar } from '@/components/Shell';
import { LegalFooter } from '@/components/ui';
import './globals.css';

export const metadata: Metadata = {
  title: 'Readiness — finance & termination planning',
  description:
    'Personal finance and termination-readiness planning for a UAE private-sector employee.',
  manifest: '/manifest.webmanifest',
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
    <html lang="en-AE">
      <body>
        <div className="shell">
          <Sidebar />
          <main>{children}</main>
        </div>
        <LegalFooter />
        <BottomTabs />
      </body>
    </html>
  );
}
