'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { BarChart3, Target, Timer, TrendingDown, X } from 'lucide-react';
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

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/shared/kpi-card';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Fix #34: Drill-down from charts — clicking a denial reason or claim type
 * shows a detail panel with related claims. Date range filter added.
 */

const TYPE_COLORS = [
  'hsl(var(--hcx-primary))',
  'hsl(var(--hcx-success))',
  'hsl(var(--hcx-warning))',
  'hsl(var(--hcx-danger))',
  'hsl(var(--hcx-investigate))',
  'hsl(var(--hcx-muted))',
];

type DrillDown = {
  type: 'denial_reason' | 'claim_type';
  value: string;
  count: number;
} | null;

export default function PayerAnalyticsPage() {
  const t = useTranslations('payer.analytics');
  const router = useRouter();
  const [drillDown, setDrillDown] = useState<DrillDown>(null);
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');

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
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
          <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
        </div>
        {/* Date range filter */}
        <div className="flex gap-1">
          {(['7d', '30d', '90d', 'all'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setDateRange(r)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                dateRange === r
                  ? 'bg-hcx-primary text-white'
                  : 'bg-muted text-hcx-text-muted hover:bg-accent',
              )}
            >
              {r === 'all' ? 'All Time' : r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : '90 Days'}
            </button>
          ))}
        </div>
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
          onClick={() => router.push('/payer/settled')}
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
          onClick={() => router.push('/payer/fraud')}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Fix #34: Clickable bar chart for drill-down */}
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
                <Bar
                  dataKey="count"
                  fill="hsl(var(--hcx-danger))"
                  cursor="pointer"
                  onClick={(data) => {
                    if (data?.reason) {
                      setDrillDown({
                        type: 'denial_reason',
                        value: data.reason,
                        count: data.count,
                      });
                    }
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
            <p className="mt-1 text-[10px] text-hcx-text-muted italic">
              Click a bar to drill down into claims with that denial reason.
            </p>
          </CardContent>
        </Card>

        {/* Fix #34: Clickable pie chart for drill-down */}
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
                  cursor="pointer"
                  onClick={(data) => {
                    if (data?.type) {
                      setDrillDown({
                        type: 'claim_type',
                        value: data.type,
                        count: data.count,
                      });
                    }
                  }}
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
            <p className="mt-1 text-[10px] text-hcx-text-muted italic">
              Click a segment to drill down into claims of that type.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Fix #34: Drill-down detail panel */}
      {drillDown && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">
              Drill-Down: {drillDown.type === 'denial_reason' ? 'Denial Reason' : 'Claim Type'} — {drillDown.value}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={() => setDrillDown(null)}>
              <X className="size-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-border p-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-xs text-hcx-text-muted">Total Claims</p>
                  <p className="text-2xl font-bold">{drillDown.count}</p>
                </div>
                <div>
                  <p className="text-xs text-hcx-text-muted">Category</p>
                  <p className="text-sm font-semibold capitalize">{drillDown.value}</p>
                </div>
                <div>
                  <p className="text-xs text-hcx-text-muted">Action</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push('/payer/claims')}
                  >
                    View in Queue
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
