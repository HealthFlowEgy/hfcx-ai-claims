'use client';

import { useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * SRS §DS-RTL-001 — persistent Arabic / English toggle.
 * Writes the preference to a cookie so next-intl picks it up on the
 * next request, then triggers a router refresh.
 */
export function LanguageToggle() {
  const locale = useLocale();
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = locale === 'ar' ? 'en' : 'ar';
    const secure =
      typeof window !== 'undefined' && window.location.protocol === 'https:'
        ? '; Secure'
        : '';
    document.cookie = `hcx_locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    startTransition(() => router.refresh());
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      disabled={pending}
      aria-label={t('language')}
    >
      <Languages className="size-4" aria-hidden />
      {locale === 'ar' ? t('english') : t('arabic')}
    </Button>
  );
}
