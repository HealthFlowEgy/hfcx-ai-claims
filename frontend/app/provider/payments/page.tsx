'use client';

import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Banknote, CheckCircle2, Clock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/shared/data-table';
import { KpiCard } from '@/components/shared/kpi-card';
import { api } from '@/lib/api';
import { formatDate, formatEgp } from '@/lib/utils';

type Payment = {
  payment_ref: string;
  claim_id: string;
  paid_on: string;
  settled_amount: number;
  method: string;
  reconciled: boolean;
};

export default function ProviderPaymentsPage() {
  const t = useTranslations('provider.payments');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';

  const { data, isLoading } = useQuery({
    queryKey: ['provider', 'payments'],
    queryFn: () => api.providerPayments(),
  });

  const payments: Payment[] = data?.items ?? [];

  const total = useMemo(
    () => payments.reduce((s, p) => s + p.settled_amount, 0),
    [payments],
  );
  const reconciled = useMemo(
    () => payments.filter((p) => p.reconciled).length,
    [payments],
  );

  const columns = useMemo<ColumnDef<Payment>[]>(
    () => [
      {
        header: t('paymentRef'),
        accessorKey: 'payment_ref',
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.payment_ref}</span>
        ),
      },
      {
        header: 'Claim',
        accessorKey: 'claim_id',
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.claim_id}</span>
        ),
      },
      {
        header: t('paidOn'),
        accessorKey: 'paid_on',
        cell: ({ row }) => formatDate(row.original.paid_on, locale),
      },
      {
        header: t('settledAmount'),
        accessorKey: 'settled_amount',
        meta: { numeric: true },
        cell: ({ row }) => formatEgp(row.original.settled_amount, locale),
      },
      { header: t('method'), accessorKey: 'method' },
      {
        header: t('reconciliationStatus'),
        accessorKey: 'reconciled',
        cell: ({ row }) =>
          row.original.reconciled ? (
            <Badge variant="success">{t('reconciled')}</Badge>
          ) : (
            <Badge variant="warning">{t('unreconciled')}</Badge>
          ),
      },
    ],
    [locale, t],
  );

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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard
          label={tc('total')}
          value={formatEgp(total, locale)}
          icon={<Banknote className="size-5" />}
        />
        <KpiCard
          label={t('reconciled')}
          value={reconciled}
          icon={<CheckCircle2 className="size-5" />}
        />
        <KpiCard
          label={t('unreconciled')}
          value={payments.length - reconciled}
          icon={<Clock className="size-5" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={payments} />
        </CardContent>
      </Card>
    </div>
  );
}
