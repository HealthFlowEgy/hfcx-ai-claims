'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Banknote,
  Clock,
  FileStack,
  TrendingDown,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/shared/kpi-card';
import { ClaimStatusBadge } from '@/components/shared/claim-status-badge';
import { api } from '@/lib/api';
import type { ProviderSummary } from '@/lib/types';
import { formatEgp, toArabicDigits } from '@/lib/utils';

/**
 * SRS §4.2.1 — Provider Dashboard.
 * KPIs + recent claims + denial alerts + status distribution donut.
 */
export default function ProviderDashboardPage() {
  const t = useTranslations('provider.dashboard');
  const tc = useTranslations('common');
  const locale = useLocale();

  const { data: summary, isLoading } = useQuery<ProviderSummary>({
    queryKey: ['provider', 'summary'],
    queryFn: () => api.providerSummary(),
  });

  const { data: claimsList } = useQuery({
    queryKey: ['provider', 'claims', 'recent'],
    queryFn: () =>
      api.listClaims({ portal: 'provider', limit: 10 }),
  });

  const s = summary ?? fallbackSummary();
  const recentClaims = claimsList?.items ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
      </header>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t('claimsToday')}
          value={s.claims_today}
          icon={<FileStack className="size-5" />}
        />
        <KpiCard
          label={t('pendingResponses')}
          value={s.pending_responses}
          icon={<Clock className="size-5" />}
          threshold={{ warn: 10, alert: 20, higherIsBad: true }}
        />
        <KpiCard
          label={t('denialRate')}
          value={`${
            locale === 'ar'
              ? toArabicDigits((s.denial_rate_30d * 100).toFixed(1))
              : (s.denial_rate_30d * 100).toFixed(1)
          }%`}
          icon={<TrendingDown className="size-5" />}
          threshold={{ warn: 0.15, alert: 0.25, higherIsBad: true }}
        />
        <KpiCard
          label={t('paymentsThisMonth')}
          value={formatEgp(s.payments_this_month_egp, locale as 'ar' | 'en')}
          icon={<Banknote className="size-5" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Recent claims */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{t('recentClaims')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-hcx-text-muted">{tc('loading')}</p>
            ) : recentClaims.length === 0 ? (
              <p className="text-sm text-hcx-text-muted">{tc('noData')}</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="text-start">
                      <th className="px-3 py-2 text-start font-medium">
                        {tc('type')}
                      </th>
                      <th className="px-3 py-2 text-start font-medium">
                        {tc('amount')}
                      </th>
                      <th className="px-3 py-2 text-start font-medium">
                        {tc('status')}
                      </th>
                      <th className="px-3 py-2 text-start font-medium">
                        {tc('date')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentClaims.map((c) => (
                      <tr key={c.claim_id} className="border-t border-border">
                        <td className="px-3 py-2">{c.claim_type}</td>
                        <td className="px-3 py-2 numeric">
                          {formatEgp(c.total_amount, locale as 'ar' | 'en')}
                        </td>
                        <td className="px-3 py-2">
                          <ClaimStatusBadge status={c.status} size="sm" />
                        </td>
                        <td className="px-3 py-2 text-hcx-text-muted">
                          {new Date(c.submitted_at).toLocaleDateString(
                            locale === 'ar' ? 'ar-EG' : 'en-EG',
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Denial alerts */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('denialAlerts')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>CLAIM-2026-0042</AlertTitle>
              <AlertDescription>
                Missing clinical documentation — AI suggests uploading
                radiology report + operative notes before re-submitting.
              </AlertDescription>
            </Alert>
            <Alert variant="warning">
              <AlertTriangle className="size-4" />
              <AlertTitle>CLAIM-2026-0039</AlertTitle>
              <AlertDescription>
                Requires pre-authorization under NHIA outpatient policy
                2024. Start pre-auth flow.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function fallbackSummary(): ProviderSummary {
  return {
    claims_today: 0,
    pending_responses: 0,
    denial_rate_30d: 0,
    payments_this_month_egp: 0,
    claim_status_distribution: [],
  };
}
