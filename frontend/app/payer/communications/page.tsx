import { getTranslations } from 'next-intl/server';

import { ComingSoon } from '@/components/shared/coming-soon';

export default async function Page() {
  const t = await getTranslations('nav');
  return (
    <ComingSoon
      title={t('communications')}
      srsReference="SRS §5.1"
    />
  );
}
