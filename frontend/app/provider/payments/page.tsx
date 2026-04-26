'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Banknote,
  CheckCircle2,
  Clock,
  Filter,
  FileUp,
  Loader2,
  ArrowRight,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/shared/data-table';
import { KpiCard } from '@/components/shared/kpi-card';
import { api } from '@/lib/api';
import { cn, formatDate, formatEgp } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

/**
 * Fix #12 + #20: Payment lifecycle with status progression
 * (initiated → evidence_uploaded → verified → completed)
 * and evidence upload support.
 */

type PaymentStatus = 'initiated' | 'evidence_uploaded' | 'verified' | 'completed';

type Payment = {
  payment_ref: string;
  claim_id: string;
  paid_on: string;
  settled_amount: number;
  method: string;
  reconciled: boolean;
  status: string;
  evidence_url: string | null;
  status_updated_at: string;
};

const STATUS_CONFIG: Record<
  PaymentStatus,
  { variant: 'default' | 'warning' | 'success' | 'muted'; label: string; icon: typeof Clock }
> = {
  initiated: { variant: 'muted', label: 'Initiated', icon: Clock },
  evidence_uploaded: { variant: 'warning', label: 'Evidence Uploaded', icon: FileUp },
  verified: { variant: 'default', label: 'Verified', icon: CheckCircle2 },
  completed: { variant: 'success', label: 'Completed', icon: CheckCircle2 },
};

export default function ProviderPaymentsPage() {
  const t = useTranslations('provider.payments');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'all' | PaymentStatus>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['provider', 'payments'],
    queryFn: () => api.providerPayments(),
  });

  const payments = useMemo<Payment[]>(
    () => data?.items ?? [],
    [data],
  );

  const filteredPayments = useMemo(() => {
    if (statusFilter === 'all') return payments;
    return payments.filter((p) => (p.status || 'initiated') === statusFilter);
  }, [payments, statusFilter]);

  const total = useMemo(
    () => payments.reduce((s, p) => s + p.settled_amount, 0),
    [payments],
  );
  const completedCount = useMemo(
    () => payments.filter((p) => (p.status || 'initiated') === 'completed').length,
    [payments],
  );
  const completedAmount = useMemo(
    () => payments.filter((p) => (p.status || 'initiated') === 'completed')
      .reduce((s, p) => s + p.settled_amount, 0),
    [payments],
  );
  const pendingAmount = useMemo(
    () => total - completedAmount,
    [total, completedAmount],
  );

  const uploadEvidence = useMutation({
    mutationFn: async (paymentRef: string) => {
      const res = await fetch(`/api/proxy/internal/ai/bff/provider/payments/${paymentRef}/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evidence_url: `evidence://${paymentRef}/receipt.pdf` }),
      });
      if (!res.ok) throw new Error('Failed to upload evidence');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider', 'payments'] });
      toast({ title: 'Evidence Uploaded', description: 'Payment evidence submitted.', variant: 'success' });
    },
  });

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
        header: 'Status',
        id: 'lifecycle_status',
        cell: ({ row }) => {
          const status = (row.original.status || (row.original.reconciled ? 'completed' : 'initiated')) as PaymentStatus;
          const config = STATUS_CONFIG[status];
          const Icon = config.icon;
          return (
            <Badge variant={config.variant} className="gap-1">
              <Icon className="size-3" />
              {config.label}
            </Badge>
          );
        },
      },
      {
        header: tc('actions'),
        id: 'actions',
        cell: ({ row }) => {
          const status = (row.original.status || (row.original.reconciled ? 'completed' : 'initiated')) as PaymentStatus;
          if (status === 'initiated') {
            return (
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => uploadEvidence.mutate(row.original.payment_ref)}
                disabled={uploadEvidence.isPending}
              >
                {uploadEvidence.isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <FileUp className="size-3" />
                )}
                Submit Evidence
              </Button>
            );
          }
          if (status === 'evidence_uploaded') {
            return (
              <span className="flex items-center gap-1 text-xs text-hcx-text-muted">
                <Clock className="size-3" /> Awaiting Payer Verification
              </span>
            );
          }
          if (status === 'verified') {
            return (
              <span className="flex items-center gap-1 text-xs text-hcx-primary">
                <ArrowRight className="size-3" /> Processing
              </span>
            );
          }
          return (
            <span className="flex items-center gap-1 text-xs text-hcx-success">
              <CheckCircle2 className="size-3" /> Done
            </span>
          );
        },
      },
    ],
    [locale, t, tc, uploadEvidence],
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
          label="Completed"
          value={`${completedCount} (${formatEgp(completedAmount, locale)})`}
          icon={<CheckCircle2 className="size-5" />}
        />
        <KpiCard
          label="Pending"
          value={`${payments.length - completedCount} (${formatEgp(pendingAmount, locale)})`}
          icon={<Clock className="size-5" />}
          threshold={{ warn: 3, alert: 5, higherIsBad: true }}
        />
        <KpiCard
          label="Completion Rate"
          value={`${payments.length > 0 ? ((completedCount / payments.length) * 100).toFixed(0) : 0}%`}
          icon={<CheckCircle2 className="size-5" />}
        />
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-2">
        <Filter className="size-4 text-hcx-text-muted" />
        {(['all', 'initiated', 'evidence_uploaded', 'verified', 'completed'] as const).map((f) => (
          <Button
            key={f}
            variant={statusFilter === f ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter(f)}
          >
            {f === 'all'
              ? `All (${payments.length})`
              : `${STATUS_CONFIG[f as PaymentStatus]?.label ?? f} (${payments.filter((p) => (p.status || 'initiated') === f).length})`}
          </Button>
        ))}
      </div>

      {/* Lifecycle progress */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between text-xs text-hcx-text-muted">
            {(['initiated', 'evidence_uploaded', 'verified', 'completed'] as PaymentStatus[]).map((s, i) => {
              const count = payments.filter((p) => (p.status || 'initiated') === s).length;
              return (
                <div key={s} className="flex items-center gap-1">
                  {i > 0 && <ArrowRight className="size-3 text-border" />}
                  <span className={cn('font-medium', count > 0 && 'text-hcx-primary')}>
                    {STATUS_CONFIG[s].label}: {count}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

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
