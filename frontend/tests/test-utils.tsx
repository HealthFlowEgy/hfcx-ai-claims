import { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';

import ar from '@/messages/ar.json';
import en from '@/messages/en.json';

export function renderWithIntl(
  ui: ReactNode,
  locale: 'ar' | 'en' = 'ar',
): { locale: 'ar' | 'en'; wrapped: ReactNode } {
  const messages = locale === 'ar' ? ar : en;
  return {
    locale,
    wrapped: (
      <NextIntlClientProvider locale={locale} messages={messages as never}>
        {ui}
      </NextIntlClientProvider>
    ),
  };
}
