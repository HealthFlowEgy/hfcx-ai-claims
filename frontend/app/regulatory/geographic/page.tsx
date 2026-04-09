'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
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
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Metric = 'claims' | 'denials' | 'fraud_rate';

/**
 * SRS §7.2.3 FR-RD-GEO-001: Geographic analysis.
 * A full heat map via react-simple-maps + Egypt GeoJSON lands in a
 * follow-up; this implementation renders a horizontal bar chart sorted
 * by the selected metric plus a drill-down info panel.
 */
export default function RegulatoryGeographicPage() {
  const t = useTranslations('regulatory.geographic');
  const [metric, setMetric] = useState<Metric>('claims');

  const { data } = useQuery({
    queryKey: ['regulatory', 'geographic'],
    queryFn: () => api.regulatoryGeographic(),
  });
  const rows = useMemo(() => data ?? [], [data]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => Number(b[metric]) - Number(a[metric]));
  }, [rows, metric]);

  const national = useMemo(() => {
    const total = rows.reduce((s, r) => s + r.claims, 0);
    const denied = rows.reduce((s, r) => s + r.denials, 0);
    const avgFraud =
      rows.length > 0
        ? rows.reduce((s, r) => s + r.fraud_rate, 0) / rows.length
        : 0;
    return { total, denied, avgFraud };
  }, [rows]);

  const fmt = (v: number) =>
    metric === 'fraud_rate' ? `${(v * 100).toFixed(1)}%` : v.toLocaleString();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('title')}</CardTitle>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as Metric)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            aria-label={t('selectMetric')}
          >
            <option value="claims">{t('claims')}</option>
            <option value="denials">{t('denials')}</option>
            <option value="fraud_rate">{t('fraudRate')}</option>
          </select>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart
              data={sorted}
              layout="vertical"
              margin={{ left: 60, right: 20 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                type="number"
                stroke="hsl(var(--hcx-text-muted))"
                tickFormatter={(v) =>
                  metric === 'fraud_rate'
                    ? `${(v * 100).toFixed(1)}%`
                    : String(v)
                }
              />
              <YAxis
                type="category"
                dataKey="governorate"
                stroke="hsl(var(--hcx-text-muted))"
              />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Bar dataKey={metric} fill="hsl(var(--hcx-primary))">
                {sorted.map((_, i) => (
                  <Cell
                    key={i}
                    fill={
                      i === 0
                        ? 'hsl(var(--hcx-danger))'
                        : 'hsl(var(--hcx-primary))'
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Drill-down grid: per-governorate cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => {
          const deviation =
            national.total > 0 ? r.claims / (national.total / rows.length) - 1 : 0;
          return (
            <Card key={r.governorate}>
              <CardContent className="space-y-1 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-hcx-text">
                    {r.governorate}
                  </span>
                  <span
                    className={cn(
                      'text-xs font-semibold',
                      deviation > 0.2
                        ? 'text-hcx-danger'
                        : deviation < -0.2
                        ? 'text-hcx-success'
                        : 'text-hcx-text-muted',
                    )}
                  >
                    {deviation > 0 ? '+' : ''}
                    {(deviation * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                  <Stat label={t('claims')} value={r.claims.toLocaleString()} />
                  <Stat label={t('denials')} value={r.denials.toLocaleString()} />
                  <Stat
                    label={t('fraudRate')}
                    value={`${(r.fraud_rate * 100).toFixed(1)}%`}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="uppercase text-hcx-text-muted">{label}</div>
      <div className="font-semibold tabular-nums text-hcx-text">{value}</div>
    </div>
  );
}
