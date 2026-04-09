'use client';

import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/shared/data-table';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

type Row = {
  insurer: string;
  compliance_score: number;
  last_audit: string;
  status: string;
};

export default function RegulatoryCompliancePage() {
  const t = useTranslations('regulatory.compliance');
  const locale = useLocale() as 'ar' | 'en';
  const { data } = useQuery({
    queryKey: ['regulatory', 'compliance'],
    queryFn: () => api.regulatoryCompliance(),
  });
  const rows = useMemo(() => data ?? [], [data]);

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { header: t('insurer'), accessorKey: 'insurer' },
      {
        header: t('complianceScore'),
        accessorKey: 'compliance_score',
        meta: { numeric: true },
        cell: ({ row }) => (
          <span>{(row.original.compliance_score * 100).toFixed(0)}%</span>
        ),
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
    ],
    [locale, t],
  );

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
    </div>
  );
}
