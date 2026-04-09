import { getTranslations } from 'next-intl/server';

import { ComingSoon } from '@/components/shared/coming-soon';

export default async function Page() {
  const t = await getTranslations('nav');
  return (
    <ComingSoon
      title={t('insurers')}
      srsReference="SRS §7.2.2 FR-RD-INS-001/002/003"
    />
  );
}
