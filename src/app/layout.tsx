import type { Metadata } from 'next';
import { Geist_Mono, Noto_Sans_JP } from 'next/font/google';
import { headers } from 'next/headers';
import { RootProvider } from '@/components/providers/root-provider';
import './globals.css';

const notoSansJP = Noto_Sans_JP({
  variable: '--font-sans',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'CareViaX Pharmacy',
  description: '在宅訪問に強い保険薬局向け業務・連携プラットフォーム',
  manifest: '/manifest.json',
  icons: {
    icon: '/icons/icon-192.svg',
    apple: '/icons/icon-192.svg',
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read the nonce injected by src/middleware.ts so it can be forwarded to
  // any server-rendered <script> or <style> elements that need a CSP nonce.
  const headersList = await headers();
  const nonce = headersList.get('x-nonce') ?? undefined;

  return (
    <html
      lang="ja"
      suppressHydrationWarning
      className={`${notoSansJP.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <RootProvider nonce={nonce}>{children}</RootProvider>
      </body>
    </html>
  );
}
