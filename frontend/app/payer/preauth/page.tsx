import { getTranslations } from 'next-intl/server';

import { ComingSoon } from '@/components/shared/coming-soon';

export default async function Page() {
  const t = await getTranslations('nav');
  return (
    <ComingSoon
      title={t('preAuth')}
      srsReference="SRS §5.2.2"
    />
  );
}
