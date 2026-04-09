import { getRequestConfig } from 'next-intl/server';

/**
 * next-intl runtime configuration.
 *
 * The locale is resolved per-request from the `hcx_locale` cookie set by
 * `LanguageToggle`, defaulting to Arabic (SRS §DS-RTL-001: Arabic RTL is
 * the default, English LTR is the secondary mode).
 */
export default getRequestConfig(async () => {
  // next-intl reads the locale from the cookie set by LanguageToggle.
  // Default to Arabic RTL per SRS §DS-RTL-001.
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  const raw = cookieStore.get('hcx_locale')?.value;
  const locale: 'ar' | 'en' = raw === 'en' ? 'en' : 'ar';

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
    timeZone: 'Africa/Cairo',
    // DD/MM/YYYY everywhere per SRS §DS-RTL-005
    formats: {
      dateTime: {
        short: {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        },
        long: {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        },
      },
      number: {
        egp: {
          style: 'currency',
          currency: 'EGP',
          maximumFractionDigits: 2,
        },
      },
    },
  };
});

export type Locale = 'ar' | 'en';

export const DEFAULT_LOCALE: Locale = 'ar';

export const LOCALE_DIR: Record<Locale, 'rtl' | 'ltr'> = {
  ar: 'rtl',
  en: 'ltr',
};
