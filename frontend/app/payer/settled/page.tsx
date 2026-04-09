'use client';

import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ClaimStatusBadge } from '@/components/shared/claim-status-badge';
import { DataTable } from '@/components/shared/data-table';
import { api } from '@/lib/api';
import type { ClaimSummary } from '@/lib/types';
import { formatDate, formatEgp, maskNationalId } from '@/lib/utils';

export default function PayerSettledPage() {
  const t = useTranslations('payer.settled');
  const tc = useTranslations('claim');
  const tco = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';

  const { data } = useQuery({
    queryKey: ['payer', 'settled'],
    queryFn: () =>
      api.listClaims({
        portal: 'payer',
        status: ['approved', 'denied'],
        limit: 100,
      }),
  });

  const columns = useMemo<ColumnDef<ClaimSummary>[]>(
    () => [
      { header: tc('id'), accessorKey: 'claim_id' },
      {
        header: tc('patientNid'),
        accessorKey: 'patient_nid_masked',
        cell: ({ row }) => (
          <span className="font-mono">
            {maskNationalId(row.original.patient_nid_masked)}
          </span>
        ),
      },
      { header: tco('type'), accessorKey: 'claim_type' },
      {
        header: tco('amount'),
        accessorKey: 'total_amount',
        meta: { numeric: true },
        cell: ({ row }) => formatEgp(row.original.total_amount, locale),
      },
      {
        header: tco('status'),
        accessorKey: 'status',
        cell: ({ row }) => (
          <ClaimStatusBadge status={row.original.status} size="sm" />
        ),
      },
      {
        header: tco('date'),
        accessorKey: 'decided_at',
        cell: ({ row }) =>
          row.original.decided_at
            ? formatDate(row.original.decided_at, locale)
            : '—',
      },
    ],
    [locale, tc, tco],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={data?.items ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}
