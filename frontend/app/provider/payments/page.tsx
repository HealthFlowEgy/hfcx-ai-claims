'use client';

import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useLocale, useTranslations } from 'next-intl';
import { Banknote, CheckCircle2, Clock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/shared/data-table';
import { KpiCard } from '@/components/shared/kpi-card';
import { formatDate, formatEgp } from '@/lib/utils';

type Payment = {
  payment_ref: string;
  claim_id: string;
  paid_on: string;
  settled_amount: number;
  method: string;
  reconciled: boolean;
};

/**
 * Provider → Payments page. SRS §4.1 + Integration Guide §20.
 *
 * Synthetic data today — follow-up BFF endpoint /bff/provider/payments
 * will pull from the HFCX /paymentnotice/request pipeline.
 */
const SEED_PAYMENTS: Payment[] = [
  {
    payment_ref: 'PAY-2026-10034',
    claim_id: 'CLAIM-2026-0042',
    paid_on: new Date(Date.now() - 86400000).toISOString(),
    settled_amount: 1820,
    method: 'Bank transfer',
    reconciled: true,
  },
  {
    payment_ref: 'PAY-2026-10033',
    claim_id: 'CLAIM-2026-0038',
    paid_on: new Date(Date.now() - 2 * 86400000).toISOString(),
    settled_amount: 2650,
    method: 'Bank transfer',
    reconciled: true,
  },
  {
    payment_ref: 'PAY-2026-10032',
    claim_id: 'CLAIM-2026-0036',
    paid_on: new Date(Date.now() - 3 * 86400000).toISOString(),
    settled_amount: 980,
    method: 'Bank transfer',
    reconciled: false,
  },
];

export default function ProviderPaymentsPage() {
  const t = useTranslations('provider.payments');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';

  const total = useMemo(
    () => SEED_PAYMENTS.reduce((s, p) => s + p.settled_amount, 0),
    [],
  );
  const reconciled = useMemo(
    () => SEED_PAYMENTS.filter((p) => p.reconciled).length,
    [],
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
          value={SEED_PAYMENTS.length - reconciled}
          icon={<Clock className="size-5" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={SEED_PAYMENTS} />
        </CardContent>
      </Card>
    </div>
  );
}
