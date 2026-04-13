'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Download, FileText } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

type ReportType = 'weekly' | 'monthly' | 'byProvider';

type ReportEntry = {
  id: string;
  type: string;
  generated_at: string;
  size_kb: number;
};

export default function SiuReportsPage() {
  const t = useTranslations('siu.reports');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const [type, setType] = useState<ReportType>('weekly');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['siu', 'reports'],
    queryFn: () => api.siuReports(),
  });

  const history: ReportEntry[] = data?.items ?? [];

  const generateMutation = useMutation({
    mutationFn: (reportType: string) =>
      api.generateSiuReport({ type: reportType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['siu', 'reports'] });
    },
  });

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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-5 text-hcx-primary" aria-hidden />
            {t('generate')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <label className="text-sm font-medium" htmlFor="report-type">
              {t('reportType')}
            </label>
            <select
              id="report-type"
              value={type}
              onChange={(e) => setType(e.target.value as ReportType)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="weekly">{t('weekly')}</option>
              <option value="monthly">{t('monthly')}</option>
              <option value="byProvider">{t('byProvider')}</option>
            </select>
          </div>
          <Button
            onClick={() => generateMutation.mutate(type)}
            disabled={generateMutation.isPending}
            aria-busy={generateMutation.isPending}
          >
            {generateMutation.isPending ? '...' : t('generate')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('history')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {history.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-xs">
                  {t(r.type as ReportType)}
                </Badge>
                <span className="font-mono text-xs">{r.id}</span>
                <span className="text-xs text-hcx-text-muted">
                  {formatDate(r.generated_at, locale)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-hcx-text-muted">
                <span className="tabular-nums">{r.size_kb} KB</span>
                <Button size="sm" variant="outline">
                  <Download className="size-3.5" aria-hidden />
                  {t('download')}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
