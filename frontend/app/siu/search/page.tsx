import { getTranslations } from 'next-intl/server';

import { ComingSoon } from '@/components/shared/coming-soon';

export default async function Page() {
  const t = await getTranslations('nav');
  return (
    <ComingSoon
      title={t('crossPayerSearch')}
      srsReference="SRS §6.2.3 FR-SIU-SRCH-001/002/003"
    />
  );
}
