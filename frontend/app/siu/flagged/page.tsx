'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable } from '@/components/shared/data-table';
import { api } from '@/lib/api';
import type { ClaimSummary } from '@/lib/types';
import { cn, formatDate, formatEgp } from '@/lib/utils';

export default function FlaggedClaimsPage() {
  const t = useTranslations('siu.flagged');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const [tab, setTab] = useState<'high' | 'medium' | 'all'>('high');

  const { data } = useQuery({
    queryKey: ['siu', 'flagged'],
    queryFn: () => api.listClaims({ portal: 'siu', limit: 500 }),
  });

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    if (tab === 'high') {
      return items.filter(
        (c) => c.ai_risk_score != null && c.ai_risk_score >= 0.8,
      );
    }
    if (tab === 'medium') {
      return items.filter(
        (c) =>
          c.ai_risk_score != null &&
          c.ai_risk_score >= 0.6 &&
          c.ai_risk_score < 0.8,
      );
    }
    return items.filter((c) => (c.ai_risk_score ?? 0) >= 0.6);
  }, [data, tab]);

  const columns = useMemo<ColumnDef<ClaimSummary>[]>(
    () => [
      { header: 'Claim ID', accessorKey: 'claim_id' },
      { header: 'Provider', accessorKey: 'provider_id' },
      { header: 'Patient', accessorKey: 'patient_nid_masked' },
      {
        header: tc('amount'),
        accessorKey: 'total_amount',
        cell: ({ row }) => (
          <span className="numeric">
            {formatEgp(row.original.total_amount, locale)}
          </span>
        ),
      },
      {
        header: 'Risk',
        accessorKey: 'ai_risk_score',
        cell: ({ row }) => (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-semibold',
              (row.original.ai_risk_score ?? 0) >= 0.8
                ? 'bg-hcx-danger/15 text-hcx-danger'
                : 'bg-hcx-warning/15 text-hcx-warning',
            )}
          >
            {((row.original.ai_risk_score ?? 0) * 100).toFixed(0)}%
          </span>
        ),
      },
      {
        header: tc('date'),
        accessorKey: 'submitted_at',
        cell: ({ row }) => formatDate(row.original.submitted_at, locale),
      },
      {
        header: tc('actions'),
        id: 'actions',
        cell: () => (
          <div className="flex gap-2">
            <Button size="sm" variant="default">
              {t('openInvestigation')}
            </Button>
            <Button size="sm" variant="ghost">
              {t('markLegitimate')}
            </Button>
          </div>
        ),
      },
    ],
    [locale, tc, t],
  );

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="high">{t('highRisk')}</TabsTrigger>
          <TabsTrigger value="medium">{t('mediumRisk')}</TabsTrigger>
          <TabsTrigger value="all">{t('allFlagged')}</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          <Card>
            <CardContent className="pt-4">
              <DataTable columns={columns} data={filtered} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
