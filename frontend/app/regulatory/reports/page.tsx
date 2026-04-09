import { getTranslations } from 'next-intl/server';

import { ComingSoon } from '@/components/shared/coming-soon';

export default async function Page() {
  const t = await getTranslations('nav');
  return (
    <ComingSoon
      title={t('reports')}
      srsReference="SRS §7.2.4 FR-RD-RPT-001/002/003"
    />
  );
}
