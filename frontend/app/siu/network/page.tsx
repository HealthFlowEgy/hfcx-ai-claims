'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { NetworkGraph } from '@/components/shared/network-graph';
import { api } from '@/lib/api';

export default function NetworkAnalysisPage() {
  const t = useTranslations('siu.network');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['siu', 'network'],
    queryFn: () => api.networkGraph({ fraud_min: 0.4 }),
    retry: 1,
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
            <div className="flex h-[400px] items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <RefreshCw className="size-6 animate-spin text-hcx-primary" />
                <p className="text-sm text-hcx-text-muted">{t('loading') ?? 'Loading…'}</p>
              </div>
            </div>
          ) : isError ? (
            <div className="flex h-[400px] items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-center">
                <AlertTriangle className="size-8 text-hcx-warning" />
                <p className="text-sm font-medium text-hcx-text">
                  {t('errorLoading') ?? 'Failed to load network data'}
                </p>
                <p className="max-w-sm text-xs text-hcx-text-muted">
                  {(error as Error)?.message ?? 'Unknown error'}
                </p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  <RefreshCw className="me-1.5 size-3.5" />
                  {t('retry') ?? 'Retry'}
                </Button>
              </div>
            </div>
          ) : data ? (
            <NetworkGraph data={data} />
          ) : (
            <div className="flex h-[400px] items-center justify-center">
              <p className="text-sm text-hcx-text-muted">{t('noData') ?? 'No data'}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
