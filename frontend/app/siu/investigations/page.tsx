'use client';

import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/shared/data-table';
import { api } from '@/lib/api';
import { formatDate, formatEgp } from '@/lib/utils';

type InvestigationCase = {
  case_id: string;
  correlation_id: string;
  assigned_to: string | null;
  workflow_status: string;
  opened_on: string;
  financial_impact_egp: number;
  provider_id: string;
};

export default function SiuInvestigationsPage() {
  const t = useTranslations('siu.investigations');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';

  const { data } = useQuery({
    queryKey: ['siu', 'investigations'],
    queryFn: () => api.siuInvestigations(),
  });

  const columns = useMemo<ColumnDef<InvestigationCase>[]>(
    () => [
      { header: t('caseId'), accessorKey: 'case_id' },
      { header: 'Provider', accessorKey: 'provider_id' },
      { header: t('assignedTo'), accessorKey: 'assigned_to' },
      {
        header: t('workflowStatus'),
        accessorKey: 'workflow_status',
        cell: ({ row }) => {
          const status = row.original.workflow_status;
          const map: Record<
            string,
            {
              variant:
                | 'default'
                | 'warning'
                | 'success'
                | 'destructive'
                | 'investigate'
                | 'muted';
              label: string;
            }
          > = {
            open: { variant: 'warning', label: t('open') },
            under_review: { variant: 'investigate', label: t('underReview') },
            referred: { variant: 'default', label: t('referred') },
            closed_legitimate: {
              variant: 'success',
              label: t('closedLegitimate'),
            },
            closed_fraud: {
              variant: 'destructive',
              label: t('closedFraud'),
            },
          };
          const entry = map[status] ?? {
            variant: 'muted' as const,
            label: status,
          };
          return <Badge variant={entry.variant}>{entry.label}</Badge>;
        },
      },
      {
        header: t('openedOn'),
        accessorKey: 'opened_on',
        cell: ({ row }) => formatDate(row.original.opened_on, locale),
      },
      {
        header: t('financialImpact'),
        accessorKey: 'financial_impact_egp',
        meta: { numeric: true },
        cell: ({ row }) => formatEgp(row.original.financial_impact_egp, locale),
      },
    ],
    [locale, t],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            {(data?.length ?? 0)} {tc('total').toLowerCase()}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={data ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}
