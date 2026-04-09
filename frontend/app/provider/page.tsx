'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Banknote,
  Clock,
  FileStack,
  TrendingDown,
} from 'lucide-react';
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/shared/kpi-card';
import { ClaimStatusBadge } from '@/components/shared/claim-status-badge';
import { api } from '@/lib/api';
import type { ProviderSummary } from '@/lib/types';
import { formatEgp, toArabicDigits } from '@/lib/utils';

/**
 * SRS §4.2.1 — Provider Dashboard.
 * KPIs + recent claims + live denial alerts + status distribution donut.
 */

const STATUS_COLORS: Record<string, string> = {
  submitted: 'hsl(var(--hcx-primary))',
  ai_analyzed: 'hsl(var(--hcx-primary-light))',
  in_review: 'hsl(var(--hcx-warning))',
  approved: 'hsl(var(--hcx-success))',
  denied: 'hsl(var(--hcx-danger))',
  settled: 'hsl(var(--hcx-success))',
  investigating: 'hsl(var(--hcx-investigate))',
  voided: 'hsl(var(--hcx-muted))',
};

export default function ProviderDashboardPage() {
  const t = useTranslations('provider.dashboard');
  const tc = useTranslations('common');
  const tStatus = useTranslations('status');
  const router = useRouter();
  const locale = useLocale() as 'ar' | 'en';

  const { data: summary, isLoading } = useQuery<ProviderSummary>({
    queryKey: ['provider', 'summary'],
    queryFn: () => api.providerSummary(),
  });

  const { data: claimsList } = useQuery({
    queryKey: ['provider', 'claims', 'recent'],
    queryFn: () => api.listClaims({ portal: 'provider', limit: 10 }),
  });

  const { data: deniedClaims } = useQuery({
    queryKey: ['provider', 'claims', 'denied'],
    queryFn: () =>
      api.listClaims({ portal: 'provider', status: ['denied'], limit: 5 }),
  });

  const s = summary ?? fallbackSummary();
  const recentClaims = claimsList?.items ?? [];
  const denials = deniedClaims?.items ?? [];

  const donutData = useMemo(
    () =>
      (s.claim_status_distribution ?? []).map((d) => ({
        name: tStatus(d.status),
        value: d.count,
        color: STATUS_COLORS[d.status] ?? 'hsl(var(--hcx-muted))',
      })),
    [s.claim_status_distribution, tStatus],
  );

  const navigateToClaim = (claimId: string) =>
    router.push(`/provider/claims?focus=${encodeURIComponent(claimId)}`);

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
          value={formatEgp(s.payments_this_month_egp, locale)}
          icon={<Banknote className="size-5" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Recent claims — rows navigate to detail view */}
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
                    <tr>
                      <th className="px-3 py-2 text-start font-medium">
                        {tc('type')}
                      </th>
                      <th className="px-3 py-2 text-end font-medium">
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
                      <tr
                        key={c.claim_id}
                        className="cursor-pointer border-t border-border transition-colors hover:bg-accent/40 focus:bg-accent/60 focus:outline-none"
                        onClick={() => navigateToClaim(c.claim_id)}
                        role="button"
                        tabIndex={0}
                        aria-label={c.claim_id}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigateToClaim(c.claim_id);
                          }
                        }}
                      >
                        <td className="px-3 py-2">{c.claim_type}</td>
                        <td className="px-3 py-2 text-end font-mono tabular-nums">
                          {formatEgp(c.total_amount, locale)}
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

        {/* Denial alerts — data-driven from /bff/claims */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('denialAlerts')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {denials.length === 0 ? (
              <p className="text-sm text-hcx-text-muted">{tc('noData')}</p>
            ) : (
              denials.map((c) => (
                <Alert variant="destructive" key={c.claim_id}>
                  <AlertTriangle className="size-4" />
                  <AlertTitle className="font-mono">{c.claim_id}</AlertTitle>
                  <AlertDescription>
                    {c.claim_type} · {formatEgp(c.total_amount, locale)}
                  </AlertDescription>
                </Alert>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Status distribution donut — SRS §4.2.1 */}
      <Card>
        <CardHeader>
          <CardTitle>{t('claimStatusDistribution')}</CardTitle>
        </CardHeader>
        <CardContent>
          {donutData.length === 0 ? (
            <p className="text-sm text-hcx-text-muted">{tc('noData')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                >
                  {donutData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
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
