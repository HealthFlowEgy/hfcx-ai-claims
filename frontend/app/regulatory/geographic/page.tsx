'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
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

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Fix #42: Heat map interactivity — clickable bars for drill-down
 * Fix #43: Regional drill-down with detailed stats panel
 */

type Metric = 'claims' | 'denials' | 'fraud_rate';
type GovRow = {
  governorate: string;
  claims: number;
  denials: number;
  fraud_rate: number;
};

export default function RegulatoryGeographicPage() {
  const t = useTranslations('regulatory.geographic');
  const [metric, setMetric] = useState<Metric>('claims');
  const [selectedGov, setSelectedGov] = useState<GovRow | null>(null);

  const { data } = useQuery({
    queryKey: ['regulatory', 'geographic'],
    queryFn: () => api.regulatoryGeographic(),
  });
  const rows: GovRow[] = useMemo(() => data ?? [], [data]);

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

      {/* National summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-xs text-hcx-text-muted">Total Claims</p>
          <p className="text-xl font-bold">{national.total.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-xs text-hcx-text-muted">Total Denials</p>
          <p className="text-xl font-bold text-hcx-danger">{national.denied.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-xs text-hcx-text-muted">Avg Fraud Rate</p>
          <p className="text-xl font-bold">{(national.avgFraud * 100).toFixed(1)}%</p>
        </div>
      </div>

      <div className={cn('grid gap-4', selectedGov ? 'grid-cols-1 lg:grid-cols-[2fr_1fr]' : 'grid-cols-1')}>
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
            {/* Fix #42: Clickable bars */}
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
                <Bar
                  dataKey={metric}
                  fill="hsl(var(--hcx-primary))"
                  cursor="pointer"
                  onClick={(data) => {
                    if (data?.governorate) {
                      const gov = rows.find((r) => r.governorate === data.governorate);
                      if (gov) setSelectedGov(gov);
                    }
                  }}
                >
                  {sorted.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={
                        selectedGov?.governorate === entry.governorate
                          ? 'hsl(var(--hcx-warning))'
                          : i === 0
                          ? 'hsl(var(--hcx-danger))'
                          : 'hsl(var(--hcx-primary))'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="mt-1 text-[10px] text-hcx-text-muted italic">
              Click a bar to drill down into that governorate.
            </p>
          </CardContent>
        </Card>

        {/* Fix #43: Regional drill-down panel */}
        {selectedGov && (
          <Card className="h-fit">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">{selectedGov.governorate}</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setSelectedGov(null)}>
                <X className="size-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-xs text-hcx-text-muted">Claims</span>
                  <p className="text-lg font-bold">{selectedGov.claims.toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-xs text-hcx-text-muted">Denials</span>
                  <p className="text-lg font-bold text-hcx-danger">{selectedGov.denials.toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-xs text-hcx-text-muted">Denial Rate</span>
                  <p className="font-bold">
                    {selectedGov.claims > 0
                      ? ((selectedGov.denials / selectedGov.claims) * 100).toFixed(1)
                      : 0}%
                  </p>
                </div>
                <div>
                  <span className="text-xs text-hcx-text-muted">Fraud Rate</span>
                  <p className={cn(
                    'font-bold',
                    selectedGov.fraud_rate > national.avgFraud ? 'text-hcx-danger' : 'text-hcx-success',
                  )}>
                    {(selectedGov.fraud_rate * 100).toFixed(1)}%
                  </p>
                </div>
              </div>

              <Separator />

              {/* Comparison to national average */}
              <div className="space-y-2">
                <p className="text-xs font-semibold">vs National Average</p>
                {(() => {
                  const avgClaims = national.total / (rows.length || 1);
                  const claimsDev = avgClaims > 0 ? (selectedGov.claims / avgClaims - 1) * 100 : 0;
                  const fraudDev = national.avgFraud > 0 ? (selectedGov.fraud_rate / national.avgFraud - 1) * 100 : 0;
                  return (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded border border-border p-2">
                        <span className="text-hcx-text-muted">Claims Volume</span>
                        <p className={cn('font-bold', claimsDev > 0 ? 'text-hcx-danger' : 'text-hcx-success')}>
                          {claimsDev > 0 ? '+' : ''}{claimsDev.toFixed(0)}%
                        </p>
                      </div>
                      <div className="rounded border border-border p-2">
                        <span className="text-hcx-text-muted">Fraud Rate</span>
                        <p className={cn('font-bold', fraudDev > 0 ? 'text-hcx-danger' : 'text-hcx-success')}>
                          {fraudDev > 0 ? '+' : ''}{fraudDev.toFixed(0)}%
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Governorate cards grid */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => {
          const deviation =
            national.total > 0 ? r.claims / (national.total / rows.length) - 1 : 0;
          return (
            <Card
              key={r.governorate}
              className={cn(
                'cursor-pointer transition-colors hover:border-hcx-primary/50',
                selectedGov?.governorate === r.governorate && 'border-hcx-primary',
              )}
              onClick={() => setSelectedGov(r)}
            >
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
