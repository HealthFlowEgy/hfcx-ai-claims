import { getTranslations } from 'next-intl/server';

import { ComingSoon } from '@/components/shared/coming-soon';

export default async function Page() {
  const t = await getTranslations('nav');
  return (
    <ComingSoon
      title={t('geographic')}
      srsReference="SRS §7.2.3 FR-RD-GEO-001/002"
    />
  );
}
