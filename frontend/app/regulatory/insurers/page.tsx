'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Eye, X } from 'lucide-react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/shared/data-table';
import { Separator } from '@/components/ui/separator';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Fix #39: Drill-down into individual insurer details
 * Fix #40: Side-by-side comparison (already had radar, enhanced)
 * Fix #41: Compliance score column with color coding
 */

type Row = {
  name: string;
  claims_volume: number;
  loss_ratio: number;
  denial_rate: number;
  processing_time_days: number;
  fraud_rate: number;
  ai_accuracy: number;
};

export default function RegulatoryInsurersPage() {
  const t = useTranslations('regulatory.insurers');
  const { data } = useQuery({
    queryKey: ['regulatory', 'insurers'],
    queryFn: () => api.regulatoryInsurers(),
  });
  const rows = useMemo(() => data ?? [], [data]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drillDown, setDrillDown] = useState<Row | null>(null);

  const toggle = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else if (next.size < 3) next.add(name);
      return next;
    });
  }, []);

  // Fix #41: Compute compliance score (0-100) based on key metrics
  const complianceScore = (r: Row): number => {
    let score = 100;
    // Penalize high denial rate (>20% = -20pts)
    if (r.denial_rate > 0.2) score -= 20;
    else if (r.denial_rate > 0.15) score -= 10;
    // Penalize high loss ratio (>90% = -15pts)
    if (r.loss_ratio > 0.9) score -= 15;
    else if (r.loss_ratio > 0.7) score -= 8;
    // Penalize slow processing (>30d = -15pts)
    if (r.processing_time_days > 30) score -= 15;
    else if (r.processing_time_days > 20) score -= 8;
    // Penalize high fraud rate (>5% = -20pts)
    if (r.fraud_rate > 0.05) score -= 20;
    else if (r.fraud_rate > 0.02) score -= 10;
    // Reward high AI accuracy
    if (r.ai_accuracy >= 0.95) score += 5;
    return Math.max(0, Math.min(100, score));
  };

  const radarData = useMemo(() => {
    const pick = rows.filter((r) => selected.has(r.name));
    const dims = [
      { dim: t('claimsVolume'), key: 'claims_volume' },
      { dim: t('lossRatio'), key: 'loss_ratio' },
      { dim: t('denialRate'), key: 'denial_rate' },
      { dim: t('processingTime'), key: 'processing_time_days' },
      { dim: t('fraudRate'), key: 'fraud_rate' },
      { dim: t('aiAccuracy'), key: 'ai_accuracy' },
    ];
    const max: Record<string, number> = {};
    for (const d of dims) {
      max[d.key] = Math.max(
        ...rows.map((r) => Number(r[d.key as keyof Row] ?? 0)),
        1,
      );
    }
    return dims.map((d) => {
      const base: Record<string, string | number> = { dim: d.dim };
      for (const r of pick) {
        base[r.name] = (Number(r[d.key as keyof Row] ?? 0) / max[d.key]) * 100;
      }
      return base;
    });
  }, [rows, selected, t]);

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        header: '',
        id: 'select',
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selected.has(row.original.name)}
            onChange={() => toggle(row.original.name)}
            aria-label={`Select ${row.original.name}`}
            className="size-4"
          />
        ),
      },
      { header: t('name'), accessorKey: 'name' },
      {
        header: t('claimsVolume'),
        accessorKey: 'claims_volume',
        meta: { numeric: true },
      },
      {
        header: t('lossRatio'),
        accessorKey: 'loss_ratio',
        meta: { numeric: true },
        cell: ({ row }) => `${(row.original.loss_ratio * 100).toFixed(1)}%`,
      },
      {
        header: t('denialRate'),
        accessorKey: 'denial_rate',
        meta: { numeric: true },
        cell: ({ row }) => (
          <span
            className={cn(
              row.original.denial_rate > 0.2 && 'text-hcx-danger',
              row.original.denial_rate < 0.12 && 'text-hcx-success',
            )}
          >
            {(row.original.denial_rate * 100).toFixed(1)}%
          </span>
        ),
      },
      {
        header: t('processingTime'),
        accessorKey: 'processing_time_days',
        meta: { numeric: true },
        cell: ({ row }) => `${row.original.processing_time_days.toFixed(1)}d`,
      },
      {
        header: t('fraudRate'),
        accessorKey: 'fraud_rate',
        meta: { numeric: true },
        cell: ({ row }) => `${(row.original.fraud_rate * 100).toFixed(2)}%`,
      },
      {
        header: t('aiAccuracy'),
        accessorKey: 'ai_accuracy',
        meta: { numeric: true },
        cell: ({ row }) => `${(row.original.ai_accuracy * 100).toFixed(0)}%`,
      },
      {
        // Fix #41: Compliance score column
        header: 'Compliance',
        id: 'compliance',
        cell: ({ row }) => {
          const score = complianceScore(row.original);
          return (
            <div className="flex items-center gap-2">
              <div className="h-2 w-12 rounded-full bg-muted">
                <div
                  className={cn(
                    'h-2 rounded-full',
                    score >= 80 ? 'bg-hcx-success' : score >= 60 ? 'bg-hcx-warning' : 'bg-hcx-danger',
                  )}
                  style={{ width: `${score}%` }}
                />
              </div>
              <span
                className={cn(
                  'text-xs font-semibold',
                  score >= 80 ? 'text-hcx-success' : score >= 60 ? 'text-hcx-warning' : 'text-hcx-danger',
                )}
              >
                {score}
              </span>
            </div>
          );
        },
      },
      {
        // Fix #39: Drill-down action
        header: '',
        id: 'actions',
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDrillDown(row.original)}
          >
            <Eye className="size-3" />
          </Button>
        ),
      },
    ],
    [selected, t, toggle],
  );

  const COLORS = [
    'hsl(var(--hcx-primary))',
    'hsl(var(--hcx-success))',
    'hsl(var(--hcx-warning))',
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      <div className={cn('grid gap-4', drillDown ? 'grid-cols-1 lg:grid-cols-[2fr_1fr]' : 'grid-cols-1')}>
        <Card>
          <CardHeader>
            <CardTitle>{t('title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable columns={columns} data={rows} />
          </CardContent>
        </Card>

        {/* Fix #39: Drill-down panel */}
        {drillDown && (
          <Card className="h-fit">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">{drillDown.name}</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setDrillDown(null)}>
                <X className="size-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-xs text-hcx-text-muted">Claims Volume</span>
                  <p className="font-bold">{drillDown.claims_volume.toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-xs text-hcx-text-muted">Loss Ratio</span>
                  <p className="font-bold">{(drillDown.loss_ratio * 100).toFixed(1)}%</p>
                </div>
                <div>
                  <span className="text-xs text-hcx-text-muted">Denial Rate</span>
                  <p className={cn('font-bold', drillDown.denial_rate > 0.2 ? 'text-hcx-danger' : 'text-hcx-success')}>
                    {(drillDown.denial_rate * 100).toFixed(1)}%
                  </p>
                </div>
                <div>
                  <span className="text-xs text-hcx-text-muted">Processing Time</span>
                  <p className="font-bold">{drillDown.processing_time_days.toFixed(1)}d</p>
                </div>
                <div>
                  <span className="text-xs text-hcx-text-muted">Fraud Rate</span>
                  <p className="font-bold">{(drillDown.fraud_rate * 100).toFixed(2)}%</p>
                </div>
                <div>
                  <span className="text-xs text-hcx-text-muted">AI Accuracy</span>
                  <p className="font-bold">{(drillDown.ai_accuracy * 100).toFixed(0)}%</p>
                </div>
              </div>
              <Separator />
              <div>
                <span className="text-xs text-hcx-text-muted">Compliance Score</span>
                <div className="flex items-center gap-2 mt-1">
                  {(() => {
                    const score = complianceScore(drillDown);
                    return (
                      <>
                        <div className="h-3 flex-1 rounded-full bg-muted">
                          <div
                            className={cn(
                              'h-3 rounded-full',
                              score >= 80 ? 'bg-hcx-success' : score >= 60 ? 'bg-hcx-warning' : 'bg-hcx-danger',
                            )}
                            style={{ width: `${score}%` }}
                          />
                        </div>
                        <span className={cn(
                          'text-lg font-bold',
                          score >= 80 ? 'text-hcx-success' : score >= 60 ? 'text-hcx-warning' : 'text-hcx-danger',
                        )}>
                          {score}/100
                        </span>
                      </>
                    );
                  })()}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Fix #40: Enhanced comparison radar chart */}
      {selected.size > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t('radarTitle')} ({selected.size} selected)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="dim" />
                <PolarRadiusAxis angle={30} domain={[0, 100]} />
                {Array.from(selected).map((name, i) => (
                  <Radar
                    key={name}
                    name={name}
                    dataKey={name}
                    stroke={COLORS[i % COLORS.length]}
                    fill={COLORS[i % COLORS.length]}
                    fillOpacity={0.2}
                  />
                ))}
              </RadarChart>
            </ResponsiveContainer>
            <p className="mt-1 text-[10px] text-hcx-text-muted italic text-center">
              Select up to 3 insurers from the table above to compare side-by-side.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
