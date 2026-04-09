'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/shared/data-table';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Row = {
  name: string;
  claims_volume: number;
  loss_ratio: number;
  denial_rate: number;
  processing_time_days: number;
  fraud_rate: number;
  ai_accuracy: number;
};

/**
 * SRS §7.2.2 FR-RD-INS-001..003 — ranked insurer comparison with a
 * radar chart overlay for up to 3 selected insurers.
 */
export default function RegulatoryInsurersPage() {
  const t = useTranslations('regulatory.insurers');
  const { data } = useQuery({
    queryKey: ['regulatory', 'insurers'],
    queryFn: () => api.regulatoryInsurers(),
  });
  const rows = useMemo(() => data ?? [], [data]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else if (next.size < 3) next.add(name);
      return next;
    });
  }, []);

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
    // Normalize each metric to 0-100 for the radar axis.
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

      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={rows} />
        </CardContent>
      </Card>

      {selected.size > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('radarTitle')}</CardTitle>
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
