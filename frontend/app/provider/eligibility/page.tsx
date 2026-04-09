import { getTranslations } from 'next-intl/server';

import { ComingSoon } from '@/components/shared/coming-soon';

export default async function Page() {
  const t = await getTranslations('nav');
  return (
    <ComingSoon
      title={t('eligibility')}
      srsReference="SRS §4.1 + Integration Guide §16"
    />
  );
}
