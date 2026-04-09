import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';

import { Providers } from '@/components/providers';
import { LOCALE_DIR } from '@/i18n';

import './globals.css';

/*
 * Fonts: we rely on system font stacks defined in globals.css rather
 * than next/font/google so the build works in air-gapped environments
 * (including the Egyptian data-sovereignty deployment per SRS NFR-003).
 * Deployments that want Noto Kufi Arabic can self-host the webfont and
 * swap in next/font/local at that point.
 */

export const metadata: Metadata = {
  title: 'HealthFlow HCX — AI-Powered Claims Exchange',
  description:
    'Egyptian national health insurance claims adjudication platform',
  icons: {
    icon: '/favicon.ico',
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = (await getLocale()) as 'ar' | 'en';
  const messages = await getMessages();
  const dir = LOCALE_DIR[locale] ?? 'rtl';

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
