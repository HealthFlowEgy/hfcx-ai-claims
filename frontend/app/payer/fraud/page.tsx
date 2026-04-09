'use client';

import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/shared/data-table';
import { api } from '@/lib/api';
import type { ClaimSummary } from '@/lib/types';
import { cn, formatDate, formatEgp, maskNationalId } from '@/lib/utils';

/**
 * SRS §5.1 — Payer fraud alerts page. Surfaces claims flagged by
 * the AI fraud-detection agent above the 0.6 risk threshold so
 * reviewers can triage before they reach the regular queue.
 */
export default function PayerFraudPage() {
  const t = useTranslations('payer.fraud');
  const tc = useTranslations('common');
  const tr = useTranslations('risk');
  const locale = useLocale() as 'ar' | 'en';

  const { data } = useQuery({
    queryKey: ['payer', 'fraud'],
    queryFn: () => api.listClaims({ portal: 'siu', limit: 200 }),
  });

  const flagged = useMemo(
    () =>
      (data?.items ?? []).filter(
        (c) => (c.ai_risk_score ?? 0) >= 0.6,
      ),
    [data],
  );

  const columns = useMemo<ColumnDef<ClaimSummary>[]>(
    () => [
      { header: 'Claim ID', accessorKey: 'claim_id' },
      { header: 'Provider', accessorKey: 'provider_id' },
      {
        header: 'Patient',
        accessorKey: 'patient_nid_masked',
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {maskNationalId(row.original.patient_nid_masked)}
          </span>
        ),
      },
      {
        header: tc('amount'),
        accessorKey: 'total_amount',
        meta: { numeric: true },
        cell: ({ row }) => formatEgp(row.original.total_amount, locale),
      },
      {
        header: tr('score'),
        accessorKey: 'ai_risk_score',
        cell: ({ row }) => {
          const score = row.original.ai_risk_score ?? 0;
          return (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-semibold',
                score >= 0.8
                  ? 'bg-hcx-danger/15 text-hcx-danger'
                  : 'bg-hcx-warning/15 text-hcx-warning',
              )}
            >
              {Math.round(score * 100)}%
            </span>
          );
        },
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
          <Button size="sm" variant="outline">
            {t('refer')}
          </Button>
        ),
      },
    ],
    [locale, t, tc, tr],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-hcx-text">
          <ShieldAlert className="size-6 text-hcx-danger" aria-hidden />
          {t('title')}
        </h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            {flagged.length} {tc('total').toLowerCase()}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={flagged} />
        </CardContent>
      </Card>
    </div>
  );
}
