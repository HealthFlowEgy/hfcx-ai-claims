'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Banknote, CheckCircle2, Loader2, Search, XCircle } from 'lucide-react';

import { KpiCard } from '@/components/shared/kpi-card';
import { api } from '@/lib/api';
import { formatEgp } from '@/lib/utils';

// ISSUE-057: Risk level colors for the distribution chart
const RISK_COLORS: Record<string, string> = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#ef4444',
  critical: '#7f1d1d',
};

export default function SiuDashboardPage() {
  const t = useTranslations('siu.dashboard');
  const locale = useLocale() as 'ar' | 'en';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['siu', 'summary'],
    queryFn: () => api.siuSummary(),
  });

  // ISSUE-058: Show loading skeleton
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-hcx-primary" />
        <span className="ms-3 text-sm text-hcx-text-muted">{t('title')}...</span>
      </div>
    );
  }

  // ISSUE-058: Show error state
  if (isError) {
    return (
      <div className="rounded-lg border border-hcx-danger/30 bg-hcx-danger/5 p-6 text-center">
        <XCircle className="mx-auto size-8 text-hcx-danger" />
        <p className="mt-2 text-sm font-medium text-hcx-danger">
          Failed to load SIU dashboard data. Please try again.
        </p>
      </div>
    );
  }

  const s = data ?? {
    flagged_total: 0,
    open_investigations: 0,
    resolved_cases: 0,
    fraud_savings_egp: 0,
    risk_distribution: [],
  };

  // ISSUE-057: Compute total for risk distribution percentages
  const riskTotal = s.risk_distribution.reduce((sum, r) => sum + r.count, 0) || 1;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t('flaggedTotal')}
          value={s.flagged_total}
          icon={<AlertTriangle className="size-5" />}
        />
        <KpiCard
          label={t('openInvestigations')}
          value={s.open_investigations}
          icon={<Search className="size-5" />}
        />
        <KpiCard
          label={t('resolvedCases')}
          value={s.resolved_cases}
          icon={<CheckCircle2 className="size-5" />}
        />
        <KpiCard
          label={t('fraudSavings')}
          value={formatEgp(s.fraud_savings_egp, locale)}
          icon={<Banknote className="size-5" />}
        />
      </div>

      {/* ISSUE-057: Risk Distribution Chart */}
      {s.risk_distribution.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold text-hcx-text">
            Risk Distribution
          </h2>
          <div className="space-y-3">
            {s.risk_distribution.map((r) => {
              const pct = Math.round((r.count / riskTotal) * 100);
              return (
                <div key={r.risk} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium capitalize text-hcx-text">{r.risk}</span>
                    <span className="tabular-nums text-hcx-text-muted">
                      {r.count} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: RISK_COLORS[r.risk] ?? '#64748b',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
