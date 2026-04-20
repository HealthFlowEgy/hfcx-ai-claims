'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
  const locale = useLocale() as 'ar' | 'en';

  // ISSUE-029: Replace router.push with slide-over panel state
  const [focusedClaim, setFocusedClaim] = useState<ClaimSummary | null>(null);

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

      <div className="relative flex gap-4">
        <Card className="flex-1">
          <CardHeader>
            <CardTitle>{t('claims')}</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={data?.items ?? []}
              searchPlaceholder={`${tco('search')}…`}
              onRowClick={(row) => setFocusedClaim(row)}
            />
          </CardContent>
        </Card>

        {/* ISSUE-029: Slide-over panel for claim details */}
        {focusedClaim && (
          <Card className="sticky top-20 w-96 shrink-0 self-start">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">{tc('details')}</CardTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setFocusedClaim(null)}
                aria-label="Close details"
              >
                <X className="size-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-hcx-text-muted">{tc('id')}</span>
                <span className="font-mono font-semibold">{focusedClaim.claim_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-hcx-text-muted">{tc('patientNid')}</span>
                <span className="font-mono">{maskNationalId(focusedClaim.patient_nid_masked)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-hcx-text-muted">{tco('type')}</span>
                <span>{focusedClaim.claim_type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-hcx-text-muted">{tc('payer')}</span>
                <span>{focusedClaim.payer_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-hcx-text-muted">{tco('amount')}</span>
                <span className="font-semibold">{formatEgp(focusedClaim.total_amount, locale)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-hcx-text-muted">{tco('status')}</span>
                <ClaimStatusBadge status={focusedClaim.status} size="sm" />
              </div>
              <div className="flex justify-between">
                <span className="text-hcx-text-muted">{tco('date')}</span>
                <span>{formatDate(focusedClaim.submitted_at, locale)}</span>
              </div>
              {focusedClaim.ai_recommendation && (
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <p className="mb-1 text-xs font-semibold text-hcx-primary">
                    AI Recommendation
                  </p>
                  <p className="text-xs text-hcx-text-muted">
                    {focusedClaim.ai_recommendation}
                  </p>
                  {focusedClaim.ai_risk_score != null && (
                    <p className="mt-1 text-xs">
                      Risk Score: <span className="font-semibold">{(focusedClaim.ai_risk_score * 100).toFixed(0)}%</span>
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
