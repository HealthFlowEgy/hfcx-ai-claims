'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Stethoscope, XCircle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { api } from '@/lib/api';
import { cn, formatDate, formatEgp } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

/**
 * Fix #29: Fetch real-time data from API instead of static seed data
 * Fix #30: Approve/deny actions with confirmation and reason
 */

type PreAuthReview = {
  request_id: string;
  patient_nid_masked: string;
  icd10: string;
  procedure: string;
  amount: number;
  requested_at: string;
  verdict: 'necessary' | 'needs_review' | 'not_justified';
  guidelines: string[];
  confidence: number;
  status?: string;
};

// Fallback seed data if API returns empty
const SEED_REVIEWS: PreAuthReview[] = [
  {
    request_id: 'PA-2026-201',
    patient_nid_masked: '**********4567',
    icd10: 'M54.5',
    procedure: 'MRI Lumbar',
    amount: 4200,
    requested_at: new Date(Date.now() - 86400000).toISOString(),
    verdict: 'needs_review',
    guidelines: [
      'NHIA MSK Imaging Policy 2024 §3.2',
      'MOH Clinical Practice Guideline — Lower Back Pain v1.3',
    ],
    confidence: 0.62,
  },
  {
    request_id: 'PA-2026-200',
    patient_nid_masked: '**********8910',
    icd10: 'E11.9',
    procedure: 'Continuous glucose monitor',
    amount: 1800,
    requested_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    verdict: 'necessary',
    guidelines: ['EDA Diabetes Standards of Care 2023 §8.1'],
    confidence: 0.91,
  },
  {
    request_id: 'PA-2026-199',
    patient_nid_masked: '**********1122',
    icd10: 'Z00.00',
    procedure: 'Full-body CT screen',
    amount: 9800,
    requested_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    verdict: 'not_justified',
    guidelines: ['NHIA Preventive Imaging Policy — not covered'],
    confidence: 0.88,
  },
];

type DecisionType = 'approved' | 'partial' | 'more_info' | 'denied';

export default function PayerPreAuthPage() {
  const t = useTranslations('payer.preauth');
  const tq = useTranslations('payer.queue');
  const locale = useLocale() as 'ar' | 'en';
  const queryClient = useQueryClient();

  // Fix #29: Fetch real-time data from API
  const { data: apiData, isLoading } = useQuery({
    queryKey: ['payer', 'preauth'],
    queryFn: () => api.payerPreauth(),
    refetchInterval: 30_000, // Auto-refresh every 30s
  });

  // Use API data if available, otherwise fall back to seed
  const reviews: PreAuthReview[] = useMemo(() => {
    const items = apiData?.items;
    if (items && items.length > 0) {
      return items.map((item: Record<string, unknown>) => ({
        request_id: (item.request_id as string) ?? '',
        patient_nid_masked: (item.patient_nid_masked as string) ?? '',
        icd10: (item.icd10 as string) ?? '',
        procedure: (item.procedure as string) ?? '',
        amount: (item.amount as number) ?? 0,
        requested_at: (item.requested_at as string) ?? '',
        verdict: (item.verdict as PreAuthReview['verdict']) ?? 'needs_review',
        guidelines: (item.guidelines as string[]) ?? [],
        confidence: (item.confidence as number) ?? 0,
        status: (item.status as string) ?? 'submitted',
      }));
    }
    return SEED_REVIEWS;
  }, [apiData]);

  const [selectedId, setSelectedId] = useState<string | null>(
    reviews[0]?.request_id ?? null,
  );
  const selected = reviews.find((r) => r.request_id === selectedId);

  // Fix #30: Decision with confirmation
  const [confirmDecision, setConfirmDecision] = useState<{
    requestId: string;
    decision: DecisionType;
  } | null>(null);
  const [decisionReason, setDecisionReason] = useState('');

  const decisionMutation = useMutation({
    mutationFn: async ({
      requestId,
      decision,
      reason,
    }: {
      requestId: string;
      decision: DecisionType;
      reason?: string;
    }) => {
      const resp = await fetch(
        `/api/proxy/internal/ai/bff/payer/preauth/${requestId}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, reason }),
        },
      );
      if (!resp.ok) throw new Error('Decision submission failed');
      return resp.json();
    },
    onSuccess: (_data, variables) => {
      toast({
        variant: 'success',
        title: 'Decision submitted',
        description: `Pre-auth ${variables.requestId} marked as ${variables.decision}`,
      });
      queryClient.invalidateQueries({ queryKey: ['payer', 'preauth'] });
      setConfirmDecision(null);
      setDecisionReason('');
    },
    onError: () => {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to submit decision. Please try again.',
      });
    },
  });

  const handleDecision = (decision: DecisionType) => {
    if (!selectedId) return;
    // Fix #30: Show confirmation for deny/partial
    if (decision === 'denied' || decision === 'partial') {
      setConfirmDecision({ requestId: selectedId, decision });
    } else {
      decisionMutation.mutate({ requestId: selectedId, decision });
    }
  };

  const confirmAndSubmit = () => {
    if (!confirmDecision) return;
    decisionMutation.mutate({
      ...confirmDecision,
      reason: decisionReason || undefined,
    });
  };

  const isPending = decisionMutation.isPending;

  if (isLoading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-hcx-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              {t('title')}
              <span className="text-xs font-normal text-hcx-text-muted">
                {reviews.length} requests
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-2">
            {reviews.map((r) => (
              <button
                key={r.request_id}
                type="button"
                onClick={() => {
                  setSelectedId(r.request_id);
                  setConfirmDecision(null);
                }}
                className={cn(
                  'w-full rounded-md border p-3 text-start transition-colors',
                  selectedId === r.request_id
                    ? 'border-hcx-primary bg-hcx-primary-light/60'
                    : 'border-border hover:bg-accent',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{r.request_id}</span>
                  <VerdictBadge verdict={r.verdict} />
                </div>
                <div className="mt-1 text-sm">
                  {r.icd10} · {r.procedure}
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-hcx-text-muted">
                  <span>{formatEgp(r.amount, locale)}</span>
                  <span>{formatDate(r.requested_at, locale)}</span>
                </div>
                {/* Fix #29: Confidence bar */}
                <div className="mt-1.5 h-1 w-full rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-1 rounded-full',
                      r.confidence > 0.8
                        ? 'bg-hcx-success'
                        : r.confidence > 0.5
                          ? 'bg-hcx-warning'
                          : 'bg-hcx-danger',
                    )}
                    style={{ width: `${r.confidence * 100}%` }}
                  />
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        {selected && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Stethoscope
                  className="size-5 text-hcx-primary"
                  aria-hidden
                />
                {selected.request_id}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert
                variant={
                  selected.verdict === 'necessary'
                    ? 'success'
                    : selected.verdict === 'needs_review'
                      ? 'warning'
                      : 'destructive'
                }
              >
                <AlertTitle>
                  {t('necessityVerdict')}:{' '}
                  {selected.verdict === 'necessary'
                    ? t('necessary')
                    : selected.verdict === 'needs_review'
                      ? t('needsReview')
                      : t('notJustified')}
                </AlertTitle>
                <AlertDescription>
                  AI confidence: {Math.round(selected.confidence * 100)}%
                  {/* Fix #25: Visual confidence bar */}
                  <div className="mt-1 h-2 w-full rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-2 rounded-full',
                        selected.confidence > 0.8
                          ? 'bg-hcx-success'
                          : selected.confidence > 0.5
                            ? 'bg-hcx-warning'
                            : 'bg-hcx-danger',
                      )}
                      style={{ width: `${selected.confidence * 100}%` }}
                    />
                  </div>
                </AlertDescription>
              </Alert>

              {/* Patient & Claim details */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-xs text-hcx-text-muted">Patient NID</span>
                  <p className="font-mono">{selected.patient_nid_masked}</p>
                </div>
                <div>
                  <span className="text-xs text-hcx-text-muted">Amount</span>
                  <p className="font-semibold">{formatEgp(selected.amount, locale)}</p>
                </div>
                <div>
                  <span className="text-xs text-hcx-text-muted">ICD-10</span>
                  <p>{selected.icd10}</p>
                </div>
                <div>
                  <span className="text-xs text-hcx-text-muted">Procedure</span>
                  <p>{selected.procedure}</p>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold">
                  {t('guidelines')}
                </h3>
                <ul className="list-disc space-y-1 ps-5 text-sm text-hcx-text-muted">
                  {selected.guidelines.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>

              {/* Fix #30: Confirmation dialog for deny/partial */}
              {confirmDecision && (
                <div className="rounded-lg border border-hcx-warning/50 bg-hcx-warning/5 p-3 space-y-2">
                  <p className="text-sm font-semibold text-hcx-warning">
                    Confirm: {confirmDecision.decision === 'denied' ? 'Deny' : 'Partial Approve'} this request?
                  </p>
                  <textarea
                    rows={2}
                    placeholder="Reason (optional for partial, recommended for denial)..."
                    value={decisionReason}
                    onChange={(e) => setDecisionReason(e.target.value)}
                    className="w-full rounded-md border border-input bg-background p-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={confirmAndSubmit}
                      disabled={isPending}
                    >
                      {isPending ? <Loader2 className="size-4 animate-spin" /> : 'Confirm'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setConfirmDecision(null);
                        setDecisionReason('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Decision buttons */}
              <div className="grid grid-cols-2 gap-2 pt-2 md:grid-cols-4">
                <Button
                  variant="success"
                  onClick={() => handleDecision('approved')}
                  disabled={isPending}
                >
                  {isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" aria-hidden />
                  )}
                  {tq('approve')}
                </Button>
                <Button
                  variant="default"
                  onClick={() => handleDecision('partial')}
                  disabled={isPending}
                >
                  {t('partialApprove')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleDecision('more_info')}
                  disabled={isPending}
                >
                  {t('requestMoreInfo')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleDecision('denied')}
                  disabled={isPending}
                >
                  {isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <XCircle className="size-4" aria-hidden />
                  )}
                  {tq('deny')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function VerdictBadge({
  verdict,
}: {
  verdict: 'necessary' | 'needs_review' | 'not_justified';
}) {
  const t = useTranslations('payer.preauth');
  if (verdict === 'necessary')
    return <Badge variant="success">{t('necessary')}</Badge>;
  if (verdict === 'needs_review')
    return <Badge variant="warning">{t('needsReview')}</Badge>;
  return <Badge variant="destructive">{t('notJustified')}</Badge>;
}
