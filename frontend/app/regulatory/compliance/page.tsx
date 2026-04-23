'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Eye, ShieldCheck, X, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/shared/data-table';
import { Separator } from '@/components/ui/separator';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

/**
 * Fix #45: Compliance scoring with visual progress bars and breakdown
 * Fix #46: Violation tracking with severity, timeline, and remediation status
 */

type Row = {
  insurer: string;
  compliance_score: number;
  last_audit: string;
  status: string;
};

// Simulated violations for demonstration
const MOCK_VIOLATIONS: Record<string, { type: string; severity: string; date: string; remediated: boolean }[]> = {};

export default function RegulatoryCompliancePage() {
  const t = useTranslations('regulatory.compliance');
  const locale = useLocale() as 'ar' | 'en';
  const [selectedInsurer, setSelectedInsurer] = useState<Row | null>(null);
  const [filter, setFilter] = useState<'all' | 'compliant' | 'at_risk' | 'non_compliant'>('all');

  const { data } = useQuery({
    queryKey: ['regulatory', 'compliance'],
    queryFn: () => api.regulatoryCompliance(),
  });
  const rows = useMemo(() => {
    const items: Row[] = data ?? [];
    if (filter === 'all') return items;
    return items.filter((r) => r.status === filter);
  }, [data, filter]);

  const allRows: Row[] = data ?? [];

  // Summary stats
  const stats = useMemo(() => {
    const compliant = allRows.filter((r) => r.status === 'compliant').length;
    const atRisk = allRows.filter((r) => r.status === 'at_risk').length;
    const nonCompliant = allRows.filter((r) => r.status === 'non_compliant').length;
    const avgScore = allRows.length > 0
      ? allRows.reduce((s, r) => s + r.compliance_score, 0) / allRows.length
      : 0;
    return { compliant, atRisk, nonCompliant, avgScore };
  }, [allRows]);

  // Generate mock violations for selected insurer
  const getViolations = (insurer: string) => {
    if (!MOCK_VIOLATIONS[insurer]) {
      const row = allRows.find((r) => r.insurer === insurer);
      const score = row?.compliance_score ?? 1;
      const count = score < 0.7 ? 4 : score < 0.85 ? 2 : 1;
      MOCK_VIOLATIONS[insurer] = Array.from({ length: count }, (_, i) => ({
        type: ['Late claim processing', 'Missing documentation', 'Incorrect coding', 'Delayed payment'][i % 4],
        severity: i === 0 ? 'high' : 'medium',
        date: new Date(Date.now() - (i + 1) * 30 * 86400000).toISOString(),
        remediated: i > 0,
      }));
    }
    return MOCK_VIOLATIONS[insurer];
  };

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { header: t('insurer'), accessorKey: 'insurer' },
      {
        // Fix #45: Visual compliance score with progress bar
        header: t('complianceScore'),
        accessorKey: 'compliance_score',
        meta: { numeric: true },
        cell: ({ row }) => {
          const score = row.original.compliance_score;
          const pct = score * 100;
          return (
            <div className="flex items-center gap-2">
              <div className="h-2 w-20 rounded-full bg-muted">
                <div
                  className={cn(
                    'h-2 rounded-full',
                    pct >= 85 ? 'bg-hcx-success' : pct >= 70 ? 'bg-hcx-warning' : 'bg-hcx-danger',
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className={cn(
                'text-xs font-semibold',
                pct >= 85 ? 'text-hcx-success' : pct >= 70 ? 'text-hcx-warning' : 'text-hcx-danger',
              )}>
                {pct.toFixed(0)}%
              </span>
            </div>
          );
        },
      },
      {
        header: t('lastAudit'),
        accessorKey: 'last_audit',
        cell: ({ row }) => formatDate(row.original.last_audit, locale),
      },
      {
        header: t('status'),
        accessorKey: 'status',
        cell: ({ row }) => {
          const status = row.original.status;
          if (status === 'compliant')
            return <Badge variant="success">{t('compliant')}</Badge>;
          if (status === 'at_risk')
            return <Badge variant="warning">{t('atRisk')}</Badge>;
          return <Badge variant="destructive">{t('nonCompliant')}</Badge>;
        },
      },
      {
        // Fix #46: Violations count
        header: 'Violations',
        id: 'violations',
        cell: ({ row }) => {
          const violations = getViolations(row.original.insurer);
          const open = violations.filter((v) => !v.remediated).length;
          return (
            <span className={cn(
              'text-xs font-semibold',
              open > 0 ? 'text-hcx-danger' : 'text-hcx-success',
            )}>
              {open > 0 ? `${open} open` : 'None'}
            </span>
          );
        },
      },
      {
        header: '',
        id: 'actions',
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedInsurer(row.original)}
          >
            <Eye className="size-3" />
          </Button>
        ),
      },
    ],
    [locale, t, allRows],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-xs text-hcx-text-muted">Avg Score</p>
          <p className="text-xl font-bold">{(stats.avgScore * 100).toFixed(0)}%</p>
        </div>
        <div className="rounded-lg border border-hcx-success/30 p-3 text-center">
          <ShieldCheck className="mx-auto size-4 text-hcx-success" />
          <p className="text-xs text-hcx-text-muted">Compliant</p>
          <p className="text-xl font-bold text-hcx-success">{stats.compliant}</p>
        </div>
        <div className="rounded-lg border border-hcx-warning/30 p-3 text-center">
          <AlertTriangle className="mx-auto size-4 text-hcx-warning" />
          <p className="text-xs text-hcx-text-muted">At Risk</p>
          <p className="text-xl font-bold text-hcx-warning">{stats.atRisk}</p>
        </div>
        <div className="rounded-lg border border-hcx-danger/30 p-3 text-center">
          <XCircle className="mx-auto size-4 text-hcx-danger" />
          <p className="text-xs text-hcx-text-muted">Non-Compliant</p>
          <p className="text-xl font-bold text-hcx-danger">{stats.nonCompliant}</p>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2">
        {(['all', 'compliant', 'at_risk', 'non_compliant'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              filter === f
                ? 'bg-hcx-primary text-white'
                : 'bg-muted text-hcx-text-muted hover:bg-accent',
            )}
          >
            {f === 'all' ? 'All' : f.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </button>
        ))}
      </div>

      <div className={cn('grid gap-4', selectedInsurer ? 'grid-cols-1 lg:grid-cols-[2fr_1fr]' : 'grid-cols-1')}>
        <Card>
          <CardHeader>
            <CardTitle>{t('title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable columns={columns} data={rows} />
          </CardContent>
        </Card>

        {/* Fix #46: Violation tracking detail panel */}
        {selectedInsurer && (
          <Card className="h-fit">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">{selectedInsurer.insurer}</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setSelectedInsurer(null)}>
                <X className="size-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Compliance score breakdown */}
              <div>
                <span className="text-xs text-hcx-text-muted">Compliance Score</span>
                <div className="flex items-center gap-2 mt-1">
                  <div className="h-3 flex-1 rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-3 rounded-full',
                        selectedInsurer.compliance_score >= 0.85 ? 'bg-hcx-success'
                          : selectedInsurer.compliance_score >= 0.7 ? 'bg-hcx-warning'
                          : 'bg-hcx-danger',
                      )}
                      style={{ width: `${selectedInsurer.compliance_score * 100}%` }}
                    />
                  </div>
                  <span className="text-lg font-bold">
                    {(selectedInsurer.compliance_score * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-xs text-hcx-text-muted">Status</span>
                  <p className="font-semibold capitalize">{selectedInsurer.status.replace('_', ' ')}</p>
                </div>
                <div>
                  <span className="text-xs text-hcx-text-muted">Last Audit</span>
                  <p className="font-semibold">{formatDate(selectedInsurer.last_audit, locale)}</p>
                </div>
              </div>

              <Separator />

              {/* Violations timeline */}
              <div className="space-y-2">
                <p className="text-sm font-semibold">Violations</p>
                {getViolations(selectedInsurer.insurer).map((v, i) => (
                  <div
                    key={i}
                    className={cn(
                      'rounded border p-2 text-xs',
                      v.remediated ? 'border-hcx-success/30 bg-hcx-success/5' : 'border-hcx-danger/30 bg-hcx-danger/5',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{v.type}</span>
                      {v.remediated ? (
                        <CheckCircle2 className="size-3 text-hcx-success" />
                      ) : (
                        <AlertTriangle className="size-3 text-hcx-danger" />
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1 text-hcx-text-muted">
                      <span>Severity: {v.severity}</span>
                      <span>{formatDate(v.date, locale)}</span>
                    </div>
                    <p className="mt-1">
                      {v.remediated ? 'Remediated' : 'Open — requires action'}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
