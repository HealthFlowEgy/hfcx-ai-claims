'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/shared/data-table';
import { ClaimStatusBadge } from '@/components/shared/claim-status-badge';
import { api } from '@/lib/api';
import type { ClaimSummary } from '@/lib/types';
import { formatDate, formatEgp, maskNationalId } from '@/lib/utils';

export default function ProviderClaimsHistoryPage() {
  const t = useTranslations('nav');
  const tc = useTranslations('claim');
  const tco = useTranslations('common');
  const router = useRouter();
  const locale = useLocale() as 'ar' | 'en';

  const { data } = useQuery({
    queryKey: ['provider', 'claims'],
    queryFn: () => api.listClaims({ portal: 'provider', limit: 100 }),
  });

  const columns = useMemo<ColumnDef<ClaimSummary>[]>(
    () => [
      {
        header: tc('id'),
        accessorKey: 'claim_id',
      },
      {
        header: tc('patientNid'),
        accessorKey: 'patient_nid_masked',
        cell: ({ row }) => (
          <span className="font-mono">
            {maskNationalId(row.original.patient_nid_masked)}
          </span>
        ),
      },
      {
        header: tco('type'),
        accessorKey: 'claim_type',
      },
      {
        header: tc('payer'),
        accessorKey: 'payer_id',
      },
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
        accessorKey: 'submitted_at',
        cell: ({ row }) => formatDate(row.original.submitted_at, locale),
      },
    ],
    [locale, tc, tco],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('claimsHistory')}</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t('claims')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={data?.items ?? []}
            searchPlaceholder={`${tco('search')}…`}
            onRowClick={(row) =>
              router.push(`/provider/claims?focus=${encodeURIComponent(row.claim_id)}`)
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
