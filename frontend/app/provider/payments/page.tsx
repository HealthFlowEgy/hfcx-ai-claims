'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Banknote, CheckCircle2, Clock, Filter } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/shared/data-table';
import { KpiCard } from '@/components/shared/kpi-card';
import { api } from '@/lib/api';
import { formatDate, formatEgp } from '@/lib/utils';

/**
 * Fix #20: Enhanced reconciliation status with visual indicators,
 * filter by reconciliation status, and payment method breakdown.
 */

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
  const [reconFilter, setReconFilter] = useState<'all' | 'reconciled' | 'unreconciled'>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['provider', 'payments'],
    queryFn: () => api.providerPayments(),
  });

  const payments = useMemo<Payment[]>(
    () => data?.items ?? [],
    [data],
  );

  // Fix #20: Filter by reconciliation status
  const filteredPayments = useMemo(() => {
    if (reconFilter === 'all') return payments;
    return payments.filter((p) =>
      reconFilter === 'reconciled' ? p.reconciled : !p.reconciled,
    );
  }, [payments, reconFilter]);

  const total = useMemo(
    () => payments.reduce((s, p) => s + p.settled_amount, 0),
    [payments],
  );
  const reconciledCount = useMemo(
    () => payments.filter((p) => p.reconciled).length,
    [payments],
  );
  const reconciledAmount = useMemo(
    () => payments.filter((p) => p.reconciled).reduce((s, p) => s + p.settled_amount, 0),
    [payments],
  );
  const unreconciledAmount = useMemo(
    () => payments.filter((p) => !p.reconciled).reduce((s, p) => s + p.settled_amount, 0),
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
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="size-3" />
              {t('reconciled')}
            </Badge>
          ) : (
            <Badge variant="warning" className="gap-1">
              <Clock className="size-3" />
              {t('unreconciled')}
            </Badge>
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <KpiCard
          label={tc('total')}
          value={formatEgp(total, locale)}
          icon={<Banknote className="size-5" />}
        />
        <KpiCard
          label={t('reconciled')}
          value={`${reconciledCount} (${formatEgp(reconciledAmount, locale)})`}
          icon={<CheckCircle2 className="size-5" />}
        />
        <KpiCard
          label={t('unreconciled')}
          value={`${payments.length - reconciledCount} (${formatEgp(unreconciledAmount, locale)})`}
          icon={<Clock className="size-5" />}
          threshold={{ warn: 3, alert: 5, higherIsBad: true }}
        />
        <KpiCard
          label="Reconciliation Rate"
          value={`${payments.length > 0 ? ((reconciledCount / payments.length) * 100).toFixed(0) : 0}%`}
          icon={<CheckCircle2 className="size-5" />}
        />
      </div>

      {/* Fix #20: Reconciliation filter */}
      <div className="flex items-center gap-2">
        <Filter className="size-4 text-hcx-text-muted" />
        {(['all', 'reconciled', 'unreconciled'] as const).map((f) => (
          <Button
            key={f}
            variant={reconFilter === f ? 'default' : 'outline'}
            size="sm"
            onClick={() => setReconFilter(f)}
          >
            {f === 'all' ? `All (${payments.length})` :
             f === 'reconciled' ? `${t('reconciled')} (${reconciledCount})` :
             `${t('unreconciled')} (${payments.length - reconciledCount})`}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={filteredPayments} />
        </CardContent>
      </Card>
    </div>
  );
}
