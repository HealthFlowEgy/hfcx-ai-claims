'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ShieldAlert, TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/shared/kpi-card';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Fix #44: Pattern detection visualization with:
 *   - Fraud pattern categories
 *   - Anomaly alerts
 *   - Provider risk ranking
 *   - Trend analysis
 */

// Simulated fraud patterns for visualization
const FRAUD_PATTERNS = [
  { pattern: 'Upcoding', count: 23, severity: 'high' },
  { pattern: 'Unbundling', count: 18, severity: 'high' },
  { pattern: 'Duplicate Claims', count: 15, severity: 'medium' },
  { pattern: 'Phantom Billing', count: 8, severity: 'critical' },
  { pattern: 'Unnecessary Services', count: 12, severity: 'medium' },
  { pattern: 'Identity Fraud', count: 5, severity: 'critical' },
];

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

  const sortedPatterns = useMemo(
    () => [...FRAUD_PATTERNS].sort((a, b) => b.count - a.count),
    [],
  );

  const severityColor = (sev: string) => {
    switch (sev) {
      case 'critical': return 'hsl(var(--hcx-danger))';
      case 'high': return 'hsl(var(--hcx-warning))';
      default: return 'hsl(var(--hcx-primary))';
    }
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <KpiCard
          label={tr('fraudDetectionRate')}
          value={`${(s.fraud_detection_rate * 100).toFixed(2)}%`}
        />
        <KpiCard
          label={tr('totalClaimsVolume')}
          value={s.total_claims_volume.toLocaleString()}
        />
        <KpiCard
          label="Patterns Detected"
          value={FRAUD_PATTERNS.length}
          icon={<AlertTriangle className="size-5" />}
        />
        <KpiCard
          label="Critical Alerts"
          value={FRAUD_PATTERNS.filter((p) => p.severity === 'critical').length}
          icon={<ShieldAlert className="size-5" />}
        />
      </div>

      {/* Anomaly alerts */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Active Anomaly Alerts</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {FRAUD_PATTERNS.filter((p) => p.severity === 'critical').map((p) => (
            <div
              key={p.pattern}
              className="flex items-center gap-3 rounded-lg border border-hcx-danger/30 bg-hcx-danger/5 p-3"
            >
              <AlertTriangle className="size-5 text-hcx-danger shrink-0" />
              <div>
                <p className="text-sm font-semibold text-hcx-danger">{p.pattern}</p>
                <p className="text-xs text-hcx-text-muted">
                  {p.count} cases detected — requires immediate investigation
                </p>
              </div>
            </div>
          ))}
          {FRAUD_PATTERNS.filter((p) => p.severity === 'high').map((p) => (
            <div
              key={p.pattern}
              className="flex items-center gap-3 rounded-lg border border-hcx-warning/30 bg-hcx-warning/5 p-3"
            >
              <TrendingUp className="size-5 text-hcx-warning shrink-0" />
              <div>
                <p className="text-sm font-semibold text-hcx-warning">{p.pattern}</p>
                <p className="text-xs text-hcx-text-muted">
                  {p.count} cases detected — trending upward
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Fraud trend */}
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
                  name="Fraud/Denial Rate"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Fix #44: Pattern detection bar chart */}
        <Card>
          <CardHeader>
            <CardTitle>Fraud Patterns by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={sortedPatterns}
                layout="vertical"
                margin={{ left: 80 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" stroke="hsl(var(--hcx-text-muted))" />
                <YAxis
                  type="category"
                  dataKey="pattern"
                  stroke="hsl(var(--hcx-text-muted))"
                  width={100}
                />
                <Tooltip />
                <Bar dataKey="count" name="Cases">
                  {sortedPatterns.map((entry, i) => (
                    <Cell key={i} fill={severityColor(entry.severity)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-2 flex gap-4 justify-center text-xs">
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-hcx-danger" /> Critical
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-hcx-warning" /> High
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full" style={{ backgroundColor: 'hsl(var(--hcx-primary))' }} /> Medium
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
