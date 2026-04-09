import { getTranslations } from 'next-intl/server';

import { ComingSoon } from '@/components/shared/coming-soon';

export default async function Page() {
  const t = await getTranslations('nav');
  return (
    <ComingSoon
      title={t('denials')}
      srsReference="SRS §4.2.5 FR-PP-DEN-001/002/003"
    />
  );
}
