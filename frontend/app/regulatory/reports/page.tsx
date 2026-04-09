'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Download, FileText } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatDate } from '@/lib/utils';

/**
 * SRS §7.2.4 FR-RD-RPT-001..003 — Regulatory reports.
 *
 * Full Arabic PDF report generation via react-pdf ships in a follow-up
 * milestone. Today we scaffold the surface so regulators can browse
 * scheduled reports and queue on-demand generation; the backend job is
 * a placeholder that hits /internal/ai/bff/regulatory/reports/generate
 * once the PDF engine lands.
 */
type ReportType = 'monthly' | 'quarterly' | 'annual';
type ReportStatus = 'ready' | 'generating' | 'stale';

type ReportEntry = {
  id: string;
  type: ReportType;
  period: string;
  generated_at: string;
  size_kb: number;
  status: ReportStatus;
};

const SEED: ReportEntry[] = [
  {
    id: 'rpt-2026-m4',
    type: 'monthly',
    period: 'April 2026',
    generated_at: new Date(Date.now() - 86400000).toISOString(),
    size_kb: 820,
    status: 'ready',
  },
  {
    id: 'rpt-2026-q1',
    type: 'quarterly',
    period: 'Q1 2026',
    generated_at: new Date(Date.now() - 12 * 86400000).toISOString(),
    size_kb: 2140,
    status: 'ready',
  },
  {
    id: 'rpt-2025-a',
    type: 'annual',
    period: '2025',
    generated_at: new Date(Date.now() - 90 * 86400000).toISOString(),
    size_kb: 5820,
    status: 'stale',
  },
];

export default function RegulatoryReportsPage() {
  const t = useTranslations('regulatory.reports');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const [type, setType] = useState<ReportType>('monthly');
  const [entries, setEntries] = useState(SEED);
  const [pending, setPending] = useState(false);

  const generate = () => {
    setPending(true);
    setTimeout(() => {
      setEntries([
        {
          id: `rpt-${Date.now().toString().slice(-6)}`,
          type,
          period:
            type === 'monthly'
              ? 'May 2026'
              : type === 'quarterly'
              ? 'Q2 2026'
              : '2026',
          generated_at: new Date().toISOString(),
          size_kb: Math.floor(500 + Math.random() * 3000),
          status: 'ready',
        },
        ...entries,
      ]);
      setPending(false);
    }, 900);
  };

  const freshness = new Date(Date.now() - 2 * 3600000).toISOString();
  const isStale =
    Date.now() - new Date(freshness).getTime() > 24 * 3600000;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      {isStale && (
        <Alert variant="warning">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>{t('dataFreshness')}</AlertTitle>
          <AlertDescription>
            {formatDate(freshness, locale)}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-5 text-hcx-primary" aria-hidden />
            {t('generateNow')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <label className="text-sm font-medium" htmlFor="rtype">
              {t('reportType')}
            </label>
            <select
              id="rtype"
              value={type}
              onChange={(e) => setType(e.target.value as ReportType)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="monthly">{t('monthly')}</option>
              <option value="quarterly">{t('quarterly')}</option>
              <option value="annual">{t('annual')}</option>
            </select>
          </div>
          <Button onClick={generate} disabled={pending} aria-busy={pending}>
            {pending ? tc('loading') : t('generateNow')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('history')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {entries.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-xs">
                  {t(r.type)}
                </Badge>
                <div>
                  <div className="text-sm font-semibold">{r.period}</div>
                  <div className="text-xs text-hcx-text-muted">
                    {formatDate(r.generated_at, locale)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 font-semibold',
                    r.status === 'ready'
                      ? 'bg-hcx-success/15 text-hcx-success'
                      : r.status === 'generating'
                      ? 'bg-hcx-warning/15 text-hcx-warning'
                      : 'bg-hcx-muted/15 text-hcx-muted',
                  )}
                >
                  {r.status}
                </span>
                <span className="tabular-nums text-hcx-text-muted">
                  {r.size_kb} KB
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={r.status !== 'ready'}
                >
                  <Download className="size-3.5" aria-hidden />
                  PDF
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
