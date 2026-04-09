'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { BarChart3, Target, Timer, TrendingDown } from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/shared/kpi-card';
import { api } from '@/lib/api';

const TYPE_COLORS = [
  'hsl(var(--hcx-primary))',
  'hsl(var(--hcx-success))',
  'hsl(var(--hcx-warning))',
  'hsl(var(--hcx-danger))',
  'hsl(var(--hcx-investigate))',
  'hsl(var(--hcx-muted))',
];

export default function PayerAnalyticsPage() {
  const t = useTranslations('payer.analytics');

  const { data } = useQuery({
    queryKey: ['payer', 'analytics'],
    queryFn: () => api.payerAnalytics(),
  });

  const s = data ?? {
    loss_ratio: 0,
    approval_rate: 0,
    avg_processing_minutes: 0,
    fraud_detection_rate: 0,
    top_denial_reasons: [],
    claims_by_type: [],
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t('lossRatio')}
          value={`${(s.loss_ratio * 100).toFixed(1)}%`}
          icon={<TrendingDown className="size-5" />}
          threshold={{ warn: 0.7, alert: 0.9, higherIsBad: true }}
        />
        <KpiCard
          label={t('claimsApprovalRate')}
          value={`${(s.approval_rate * 100).toFixed(1)}%`}
          icon={<Target className="size-5" />}
        />
        <KpiCard
          label={t('avgProcessingTime')}
          value={`${s.avg_processing_minutes.toFixed(0)}m`}
          icon={<Timer className="size-5" />}
        />
        <KpiCard
          label={t('fraudDetectionRate')}
          value={`${(s.fraud_detection_rate * 100).toFixed(1)}%`}
          icon={<BarChart3 className="size-5" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('topDenialReasons')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={s.top_denial_reasons}
                layout="vertical"
                margin={{ left: 40 }}
              >
                <XAxis type="number" stroke="hsl(var(--hcx-text-muted))" />
                <YAxis
                  dataKey="reason"
                  type="category"
                  stroke="hsl(var(--hcx-text-muted))"
                  width={120}
                />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--hcx-danger))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('claimsByType')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={s.claims_by_type}
                  dataKey="count"
                  nameKey="type"
                  outerRadius={90}
                  label
                >
                  {s.claims_by_type.map((_, i) => (
                    <Cell
                      key={i}
                      fill={TYPE_COLORS[i % TYPE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
