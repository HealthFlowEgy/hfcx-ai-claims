'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NetworkGraph } from '@/components/shared/network-graph';
import { api } from '@/lib/api';

export default function NetworkAnalysisPage() {
  const t = useTranslations('siu.network');

  const { data, isLoading } = useQuery({
    queryKey: ['siu', 'network'],
    queryFn: () => api.networkGraph({ fraud_min: 0.4 }),
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('description')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-hcx-text-muted">Loading…</p>
          ) : data ? (
            <NetworkGraph data={data} />
          ) : (
            <p className="text-sm text-hcx-text-muted">No data</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
