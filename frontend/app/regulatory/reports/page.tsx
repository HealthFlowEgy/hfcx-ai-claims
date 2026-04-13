'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Download, FileText } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

type ReportType = 'monthly' | 'quarterly' | 'annual';
type ReportEntry = {
  id: string;
  type: string;
  period: string;
  generated_at: string;
  size_kb: number;
  status: string;
};

export default function RegulatoryReportsPage() {
  const t = useTranslations('regulatory.reports');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const [type, setType] = useState<ReportType>('monthly');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['regulatory', 'reports'],
    queryFn: () => api.regulatoryReports(),
  });

  const entries: ReportEntry[] = data?.items ?? [];

  const generateMutation = useMutation({
    mutationFn: (reportType: string) =>
      api.generateRegulatoryReport({ type: reportType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory', 'reports'] });
    },
  });

  const freshness = new Date(Date.now() - 2 * 3600000).toISOString();
  const isStale =
    Date.now() - new Date(freshness).getTime() > 24 * 3600000;

  if (isLoading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <p className="text-sm text-hcx-text-muted">{tc('loading')}</p>
      </div>
    );
  }

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
          <Button
            onClick={() => generateMutation.mutate(type)}
            disabled={generateMutation.isPending}
            aria-busy={generateMutation.isPending}
          >
            {generateMutation.isPending ? tc('loading') : t('generateNow')}
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
                  {t(r.type as ReportType)}
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
