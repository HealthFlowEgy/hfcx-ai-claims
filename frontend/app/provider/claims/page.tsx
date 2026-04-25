'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { Filter, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/shared/data-table';
import { ClaimStatusBadge } from '@/components/shared/claim-status-badge';
import { api } from '@/lib/api';
import type { ClaimSummary, ClaimStatus } from '@/lib/types';
import { formatDate, formatEgp, maskNationalId } from '@/lib/utils';

/**
 * Provider Claims History page.
 *
 * Fix #14: Show patient name (masked NID + readable label)
 * Fix #15: Status filter chips for quick filtering
 * Fix #16: Pagination info (page X of Y)
 */

const STATUS_OPTIONS: ClaimStatus[] = [
  'submitted',
  'under_ai_review',
  'in_review',
  'ai_analyzed',
  'pending_payer_decision',
  'approved',
  'denied',
  'partial',
  'investigating',
  'settled',
  'paid',
  'voided',
];

export default function ProviderClaimsHistoryPage() {
  const t = useTranslations('nav');
  const tc = useTranslations('claim');
  const tco = useTranslations('common');
  const tStatus = useTranslations('status');
  const locale = useLocale() as 'ar' | 'en';

  const [focusedClaim, setFocusedClaim] = useState<ClaimSummary | null>(null);
  // Fix #15: Status filter
  const [statusFilter, setStatusFilter] = useState<ClaimStatus | null>(null);

  const { data } = useQuery({
    queryKey: ['provider', 'claims'],
    queryFn: () => api.listClaims({ portal: 'provider', limit: 200 }),
    refetchInterval: 30_000, // Fix #5: Auto-refresh to pick up new claims
  });

  // Fix #15: Filter claims by selected status
  const filteredItems = useMemo(() => {
    const items = data?.items ?? [];
    if (!statusFilter) return items;
    return items.filter((c) => c.status === statusFilter);
  }, [data?.items, statusFilter]);

  const columns = useMemo<ColumnDef<ClaimSummary>[]>(
    () => [
      {
        header: tc('id'),
        accessorKey: 'claim_id',
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.claim_id}</span>
        ),
      },
      {
        // Fix #14: Patient column with masked NID
        header: tc('patientNid'),
        accessorKey: 'patient_nid_masked',
        cell: ({ row }) => (
          <span className="font-mono text-xs">
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

      {/* Fix #15: Status filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="size-4 text-hcx-text-muted" />
        <Button
          variant={statusFilter === null ? 'default' : 'outline'}
          size="sm"
          onClick={() => setStatusFilter(null)}
        >
          {tco('all')} ({data?.items?.length ?? 0})
        </Button>
        {STATUS_OPTIONS.map((s) => {
          const count = (data?.items ?? []).filter((c) => c.status === s).length;
          if (count === 0) return null;
          return (
            <Button
              key={s}
              variant={statusFilter === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(statusFilter === s ? null : s)}
            >
              {tStatus(s)} ({count})
            </Button>
          );
        })}
      </div>

      <div className="relative flex gap-4">
        <Card className="flex-1 min-w-0">
          <CardHeader>
            <CardTitle>
              {t('claims')}
              {statusFilter && (
                <span className="ml-2 text-sm font-normal text-hcx-text-muted">
                  — {tStatus(statusFilter)}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={filteredItems}
              searchPlaceholder={`${tco('search')}…`}
              onRowClick={(row) => setFocusedClaim(row)}
            />
          </CardContent>
        </Card>

        {/* Slide-over panel for claim details */}
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
                <span className="font-mono font-semibold text-xs">{focusedClaim.claim_id}</span>
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
              {/* AI Recommendation section — Fix #7: framed as recommendation */}
              {focusedClaim.ai_recommendation && (
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <p className="mb-1 text-xs font-semibold text-hcx-primary">
                    AI Recommendation
                  </p>
                  <p className="text-xs capitalize">
                    {focusedClaim.ai_recommendation}
                  </p>
                  {focusedClaim.ai_risk_score != null && (
                    <div className="mt-2">
                      <p className="text-xs text-hcx-text-muted mb-1">
                        Risk Score
                      </p>
                      <div className="h-2 w-full rounded-full bg-muted">
                        <div
                          className={`h-2 rounded-full ${
                            focusedClaim.ai_risk_score > 0.7
                              ? 'bg-hcx-danger'
                              : focusedClaim.ai_risk_score > 0.4
                                ? 'bg-hcx-warning'
                                : 'bg-hcx-success'
                          }`}
                          style={{ width: `${focusedClaim.ai_risk_score * 100}%` }}
                        />
                      </div>
                      <p className="mt-0.5 text-xs font-semibold">
                        {(focusedClaim.ai_risk_score * 100).toFixed(0)}%
                      </p>
                    </div>
                  )}
                  <p className="mt-2 text-[10px] text-hcx-text-muted italic">
                    This is an AI-generated recommendation. Final decision is made by a human reviewer.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
