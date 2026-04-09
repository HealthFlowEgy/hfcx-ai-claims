'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Building2,
  FileStack,
  ShieldAlert,
  Timer,
  TrendingDown,
  TrendingUp,
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

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/shared/kpi-card';
import { api } from '@/lib/api';

export default function RegulatoryDashboardPage() {
  const t = useTranslations('regulatory.dashboard');
  const locale = useLocale() as 'ar' | 'en';

  const { data } = useQuery({
    queryKey: ['regulatory', 'summary'],
    queryFn: () => api.regulatorySummary(),
  });

  const s = data ?? {
    total_claims_volume: 0,
    market_loss_ratio: 0,
    market_denial_rate: 0,
    avg_settlement_days: 0,
    fraud_detection_rate: 0,
    active_insurers: 0,
    trend_by_month: [],
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>

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
              />
              <Line
                type="monotone"
                dataKey="denial_rate"
                stroke="hsl(var(--hcx-danger))"
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
