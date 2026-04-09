'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ShieldAlert } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/shared/kpi-card';
import { api } from '@/lib/api';

/**
 * SRS §7.1 / §7.2 — Fraud oversight.
 * Market-wide fraud KPIs + 12-month trend. Data derives from
 * `/internal/ai/bff/regulatory/summary` already shipped; the trend
 * series comes from the same endpoint's `trend_by_month` array
 * (the backend aggregates `denial_rate` which correlates with fraud
 * flags in the current dataset).
 */
export default function RegulatoryFraudPage() {
  const t = useTranslations('regulatory.fraud');
  const tr = useTranslations('regulatory.dashboard');

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
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-hcx-text">
          <ShieldAlert className="size-6 text-hcx-danger" aria-hidden />
          {t('title')}
        </h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard
          label={tr('fraudDetectionRate')}
          value={`${(s.fraud_detection_rate * 100).toFixed(2)}%`}
        />
        <KpiCard
          label={tr('totalClaimsVolume')}
          value={s.total_claims_volume.toLocaleString()}
        />
        <KpiCard
          label={tr('activeInsurers')}
          value={s.active_insurers}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('title')} — 12 months</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={s.trend_by_month}>
              <defs>
                <linearGradient id="fraudGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="hsl(var(--hcx-danger))"
                    stopOpacity={0.4}
                  />
                  <stop
                    offset="95%"
                    stopColor="hsl(var(--hcx-danger))"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" stroke="hsl(var(--hcx-text-muted))" />
              <YAxis stroke="hsl(var(--hcx-text-muted))" />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="denial_rate"
                stroke="hsl(var(--hcx-danger))"
                fill="url(#fraudGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
