'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Building2,
  Download,
  FileStack,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Timer,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/shared/kpi-card';
import { api } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

/**
 * Fix #37: Real-time data refresh with auto-refresh indicator
 * Fix #38: Export functionality for CSV/PDF
 */

export default function RegulatoryDashboardPage() {
  const t = useTranslations('regulatory.dashboard');
  const locale = useLocale() as 'ar' | 'en';

  // Fix #37: Auto-refresh every 30s
  const { data, isLoading, isError, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ['regulatory', 'summary'],
    queryFn: () => api.regulatorySummary(),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-hcx-primary" />
        <span className="ms-3 text-sm text-hcx-text-muted">Loading...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-hcx-danger/30 bg-hcx-danger/5 p-6 text-center">
        <XCircle className="mx-auto size-8 text-hcx-danger" />
        <p className="mt-2 text-sm font-medium text-hcx-danger">
          Failed to load regulatory dashboard data. Please try again.
        </p>
      </div>
    );
  }

  const s = data ?? {
    total_claims_volume: 0,
    market_loss_ratio: 0,
    market_denial_rate: 0,
    avg_settlement_days: 0,
    fraud_detection_rate: 0,
    active_insurers: 0,
    trend_by_month: [],
  };

  // Fix #38: Export to CSV
  const exportCSV = () => {
    const rows = [
      ['Metric', 'Value'],
      ['Total Claims Volume', String(s.total_claims_volume)],
      ['Market Loss Ratio', `${(s.market_loss_ratio * 100).toFixed(1)}%`],
      ['Market Denial Rate', `${(s.market_denial_rate * 100).toFixed(1)}%`],
      ['Avg Settlement Days', String(s.avg_settlement_days.toFixed(0))],
      ['Fraud Detection Rate', `${(s.fraud_detection_rate * 100).toFixed(1)}%`],
      ['Active Insurers', String(s.active_insurers)],
      [],
      ['Month', 'Claims', 'Denial Rate'],
      ...s.trend_by_month.map((m: { month: string; claims: number; denial_rate: number }) => [
        m.month,
        String(m.claims),
        String(m.denial_rate),
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `regulatory_market_overview_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'CSV Exported', variant: 'success' });
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <div className="flex items-center gap-3">
          {/* Fix #37: Real-time indicator */}
          {dataUpdatedAt > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-hcx-text-muted">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-hcx-success opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-hcx-success" />
              </span>
              Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
          {/* Fix #38: Export */}
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="size-4" />
            Export CSV
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label={t('totalClaimsVolume')}
          value={s.total_claims_volume}
          icon={<FileStack className="size-5" />}
        />
        <KpiCard
          label={t('marketLossRatio')}
          value={`${(s.market_loss_ratio * 100).toFixed(1)}%`}
          threshold={{ warn: 0.7, alert: 1.0, higherIsBad: true }}
          icon={<TrendingDown className="size-5" />}
        />
        <KpiCard
          label={t('marketDenialRate')}
          value={`${(s.market_denial_rate * 100).toFixed(1)}%`}
          threshold={{ warn: 0.2, alert: 0.25, higherIsBad: true }}
          icon={<TrendingUp className="size-5" />}
        />
        <KpiCard
          label={t('avgSettlementTime')}
          value={`${s.avg_settlement_days.toFixed(0)}d`}
          threshold={{ warn: 25, alert: 30, higherIsBad: true }}
          icon={<Timer className="size-5" />}
        />
        <KpiCard
          label={t('fraudDetectionRate')}
          value={`${(s.fraud_detection_rate * 100).toFixed(1)}%`}
          icon={<ShieldAlert className="size-5" />}
        />
        <KpiCard
          label={t('activeInsurers')}
          value={s.active_insurers}
          icon={<Building2 className="size-5" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trend — 12 months</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={s.trend_by_month}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="month"
                reversed={locale === 'ar'}
                stroke="hsl(var(--hcx-text-muted))"
              />
              <YAxis stroke="hsl(var(--hcx-text-muted))" />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="claims"
                stroke="hsl(var(--hcx-primary))"
                strokeWidth={2}
                name="Claims"
              />
              <Line
                type="monotone"
                dataKey="denial_rate"
                stroke="hsl(var(--hcx-danger))"
                strokeWidth={2}
                name="Denial Rate"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
