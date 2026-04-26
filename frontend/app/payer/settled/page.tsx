'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Download, FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ClaimStatusBadge } from '@/components/shared/claim-status-badge';
import { DataTable } from '@/components/shared/data-table';
import { api } from '@/lib/api';
import type { ClaimSummary } from '@/lib/types';
import { cn, formatDate, formatEgp, maskNationalId } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

/**
 * Fix #31: EOB (Explanation of Benefits) download for settled claims
 * Fix #32: Payment tracking with reconciliation status
 */

export default function PayerSettledPage() {
  const t = useTranslations('payer.settled');
  const tc = useTranslations('claim');
  const tco = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'approved' | 'denied' | 'settled' | 'paid'>('all');

  // BUG-09 + FEAT-01: Confirm payment mutation for payer role
  const confirmPayment = useMutation({
    mutationFn: async (claimId: string) => {
      const res = await fetch(`/api/proxy/internal/ai/bff/payer/claims/${claimId}/confirm-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Failed to confirm payment');
      return res.json();
    },
    onSuccess: (_data, claimId) => {
      queryClient.invalidateQueries({ queryKey: ['payer', 'settled'] });
      toast({ title: 'Payment Confirmed', description: `Payment for ${claimId} confirmed.`, variant: 'success' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to confirm payment.', variant: 'destructive' });
    },
  });

  const { data } = useQuery({
    queryKey: ['payer', 'settled'],
    queryFn: () =>
      api.listClaims({
        portal: 'payer',
        status: ['approved', 'denied', 'settled', 'paid'],
        limit: 200,
      }),
  });

  const filteredItems = useMemo(() => {
    const items = data?.items ?? [];
    if (filter === 'all') return items;
    return items.filter((c) => c.status === filter);
  }, [data, filter]);

  // Fix #31: EOB download handler
  const handleDownloadEOB = async (claim: ClaimSummary) => {
    try {
      // Generate a simple EOB document
      const eobContent = [
        `EXPLANATION OF BENEFITS (EOB)`,
        `=============================`,
        `Claim ID: ${claim.claim_id}`,
        `Patient NID: ${claim.patient_nid_masked}`,
        `Provider: ${claim.provider_id}`,
        `Payer: ${claim.payer_id}`,
        `Claim Type: ${claim.claim_type}`,
        `Total Amount: EGP ${claim.total_amount.toLocaleString()}`,
        `Status: ${claim.status.toUpperCase()}`,
        `Submitted: ${claim.submitted_at ? new Date(claim.submitted_at).toLocaleDateString() : 'N/A'}`,
        `Decided: ${claim.decided_at ? new Date(claim.decided_at).toLocaleDateString() : 'N/A'}`,
        ``,
        `AI Recommendation: ${claim.ai_recommendation ?? 'N/A'}`,
        `AI Risk Score: ${claim.ai_risk_score != null ? (claim.ai_risk_score * 100).toFixed(0) + '%' : 'N/A'}`,
        ``,
        `This is an auto-generated Explanation of Benefits.`,
        `Generated: ${new Date().toISOString()}`,
      ].join('\n');

      const blob = new Blob([eobContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `EOB_${claim.claim_id}.txt`;
      a.click();
      URL.revokeObjectURL(url);

      toast({
        title: 'EOB Downloaded',
        description: `Explanation of Benefits for ${claim.claim_id} downloaded.`,
        variant: 'success',
      });
    } catch {
      toast({
        title: 'Download Failed',
        description: 'Failed to generate EOB. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const columns = useMemo<ColumnDef<ClaimSummary>[]>(
    () => [
      { header: tc('id'), accessorKey: 'claim_id' },
      {
        header: tc('patientNid'),
        accessorKey: 'patient_nid_masked',
        cell: ({ row }) => (
          <span className="font-mono">
            {maskNationalId(row.original.patient_nid_masked)}
          </span>
        ),
      },
      { header: tco('type'), accessorKey: 'claim_type' },
      {
        header: tco('amount'),
        accessorKey: 'total_amount',
        meta: { numeric: true },
        cell: ({ row }) => formatEgp(row.original.total_amount, locale),
      },
      {
        header: tco('status'),
        accessorKey: 'status',
        cell: ({ row }) => (
          <ClaimStatusBadge status={row.original.status} size="sm" />
        ),
      },
      {
        // Fix #32: Payment/reconciliation status
        header: 'Payment',
        id: 'payment_status',
        cell: ({ row }) => {
          const s = row.original.status;
          if (s === 'settled' || s === 'paid') {
            return (
              <span className="inline-flex items-center gap-1 rounded-full bg-hcx-success/10 px-2 py-0.5 text-xs text-hcx-success">
                Paid
              </span>
            );
          }
          if (s === 'approved') {
            return (
              <span className="inline-flex items-center gap-1 rounded-full bg-hcx-warning/10 px-2 py-0.5 text-xs text-hcx-warning">
                Pending Payment
              </span>
            );
          }
          return (
            <span className="text-xs text-hcx-text-muted">N/A</span>
          );
        },
      },
      {
        header: tco('date'),
        accessorKey: 'decided_at',
        cell: ({ row }) =>
          row.original.decided_at
            ? formatDate(row.original.decided_at, locale)
            : '—',
      },
      {
        // BUG-09 + FEAT-01: Confirm Payment action for payer
        header: 'Action',
        id: 'confirm_payment',
        cell: ({ row }) => {
          if (row.original.status === 'approved') {
            return (
              <Button
                variant="default"
                size="sm"
                className="gap-1"
                onClick={() => confirmPayment.mutate(row.original.claim_id)}
                disabled={confirmPayment.isPending}
              >
                Confirm Payment
              </Button>
            );
          }
          return null;
        },
      },
      {
        // Fix #31: EOB download column
        header: 'EOB',
        id: 'eob',
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleDownloadEOB(row.original)}
            title="Download Explanation of Benefits"
          >
            <Download className="size-4" />
          </Button>
        ),
      },
    ],
    [locale, tc, tco, confirmPayment],
  );

  // Summary stats
  const stats = useMemo(() => {
    const items = data?.items ?? [];
    const approved = items.filter((c) => c.status === 'approved');
    const denied = items.filter((c) => c.status === 'denied');
    const settled = items.filter((c) => c.status === 'settled' || c.status === 'paid');
    const totalPaid = settled.reduce((sum, c) => sum + c.total_amount, 0);
    return { approved: approved.length, denied: denied.length, settled: settled.length, totalPaid };
  }, [data]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      {/* Fix #32: Payment tracking summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-xs text-hcx-text-muted">Total Settled</p>
          <p className="text-xl font-bold text-hcx-success">{stats.settled}</p>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-xs text-hcx-text-muted">Approved (Pending Payment)</p>
          <p className="text-xl font-bold text-hcx-warning">{stats.approved}</p>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-xs text-hcx-text-muted">Denied</p>
          <p className="text-xl font-bold text-hcx-danger">{stats.denied}</p>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-xs text-hcx-text-muted">Total Paid</p>
          <p className="text-xl font-bold">{formatEgp(stats.totalPaid, locale)}</p>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2">
        {(['all', 'approved', 'denied', 'settled', 'paid'] as const).map((f) => (
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
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-5 text-hcx-primary" />
            {t('title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={filteredItems} />
        </CardContent>
      </Card>
    </div>
  );
}
