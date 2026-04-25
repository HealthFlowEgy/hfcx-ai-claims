'use client';

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Bell, CheckSquare, Loader2, X } from 'lucide-react';
import { useClaimUpdates } from '@/hooks/use-claim-updates';
import { toast } from '@/hooks/use-toast';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ClaimCard } from '@/components/shared/claim-card';
import { ClaimStatusBadge } from '@/components/shared/claim-status-badge';
import { AIRecommendationCard } from '@/components/shared/ai-recommendation-card';
import { api } from '@/lib/api';
import type { AICoordinateResponse, ClaimStatus, ClaimSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * SRS §5.2.1 — Payer Claims Queue (Kanban + detail panel).
 *
 * Fix #25: AI confidence score visible in claim cards and detail panel
 * Fix #26: Override with mandatory reason when disagreeing with AI
 * Fix #27: Batch operations (approve/deny multiple claims)
 * Fix #28: Claim history in detail panel
 */

const COLUMN_STATUSES: Record<string, ClaimStatus[]> = {
  new: ['submitted'],
  ai: ['ai_analyzed', 'under_ai_review'],
  pending: ['in_review', 'pending_payer_decision'],
  done: ['approved', 'denied', 'partial', 'settled', 'paid'],
};

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const then = new Date(iso);
  const now = new Date();
  return (
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate()
  );
}

export default function PayerClaimsQueuePage() {
  const t = useTranslations('payer.queue');
  const tc = useTranslations('common');

  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [liveCount, setLiveCount] = useState(0);
  // Fix #27: Batch selection
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [batchMode, setBatchMode] = useState(false);

  useClaimUpdates((event) => {
    if (event.status === 'completed' || event.status === 'failed') {
      queryClient.invalidateQueries({ queryKey: ['payer', 'claims'] });
      setLiveCount((c) => c + 1);
      const decision = event.decision ?? 'unknown';
      toast({
        title: `Claim ${event.claim_id} — AI ${decision}`,
        description:
          event.status === 'completed'
            ? `AI adjudication complete (${decision}).`
            : `AI processing failed: ${event.error ?? 'unknown error'}`,
        variant: event.status === 'completed' ? 'success' : 'destructive',
      });
    }
  });

  const { data } = useQuery({
    queryKey: ['payer', 'claims'],
    queryFn: () => api.listClaims({ portal: 'payer', limit: 200 }),
    refetchInterval: 30_000,
  });

  const columns = useMemo(() => {
    const items = data?.items ?? [];
    return {
      new: items.filter((c) => COLUMN_STATUSES.new.includes(c.status)),
      ai: items.filter((c) => COLUMN_STATUSES.ai.includes(c.status)),
      pending: items.filter((c) => COLUMN_STATUSES.pending.includes(c.status)),
      done: items.filter(
        (c) =>
          COLUMN_STATUSES.done.includes(c.status) && isToday(c.decided_at),
      ),
    };
  }, [data]);

  const selectedClaim = useMemo(() => {
    if (!selected) return null;
    return (data?.items ?? []).find((c) => c.claim_id === selected) ?? null;
  }, [selected, data]);

  // Fix #27: Batch toggle
  const toggleBatch = (claimId: string) => {
    setBatchSelected((prev) => {
      const next = new Set(prev);
      if (next.has(claimId)) next.delete(claimId);
      else next.add(claimId);
      return next;
    });
  };

  // Fix #27: Batch approve/deny
  const batchMutation = useMutation({
    mutationFn: async (decision: 'approved' | 'denied') => {
      const promises = Array.from(batchSelected).map((claimId) => {
        const claim = (data?.items ?? []).find((c) => c.claim_id === claimId);
        if (!claim) return Promise.resolve();
        return api.submitClaimDecision({
          correlation_id: claim.correlation_id,
          decision,
          reason: `Batch ${decision}`,
        });
      });
      return Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payer', 'claims'] });
      setBatchSelected(new Set());
      setBatchMode(false);
      toast({
        title: 'Batch Decision Submitted',
        description: `${batchSelected.size} claims processed.`,
        variant: 'success',
      });
    },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
          {liveCount > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-hcx-success/10 px-2 py-0.5 text-xs font-medium text-hcx-success">
              <Bell className="size-3" />
              {liveCount} live update{liveCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Fix #27: Batch mode toggle */}
          <Button
            variant={batchMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setBatchMode(!batchMode);
              if (batchMode) setBatchSelected(new Set());
            }}
          >
            <CheckSquare className="size-4" />
            {batchMode ? `Batch (${batchSelected.size})` : 'Batch Mode'}
          </Button>
          {batchMode && batchSelected.size > 0 && (
            <>
              <Button
                variant="success"
                size="sm"
                onClick={() => batchMutation.mutate('approved')}
                disabled={batchMutation.isPending}
              >
                Approve ({batchSelected.size})
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => batchMutation.mutate('denied')}
                disabled={batchMutation.isPending}
              >
                Deny ({batchSelected.size})
              </Button>
            </>
          )}
          <span className="flex items-center gap-1.5 text-xs text-hcx-text-muted">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-hcx-success opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-hcx-success" />
            </span>
            Live
          </span>
        </div>
      </header>

      <div
        className={cn(
          'grid gap-4 transition-all',
          selected ? 'grid-cols-1 lg:grid-cols-[2fr_3fr]' : 'grid-cols-1',
        )}
      >
        {/* Kanban */}
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <KanbanColumn
            title={t('new')}
            items={columns.new}
            selected={selected}
            onSelect={batchMode ? toggleBatch : setSelected}
            accent="border-hcx-primary/40"
            batchMode={batchMode}
            batchSelected={batchSelected}
          />
          <KanbanColumn
            title={t('aiReviewed')}
            items={columns.ai}
            selected={selected}
            onSelect={batchMode ? toggleBatch : setSelected}
            accent="border-hcx-primary/60"
            batchMode={batchMode}
            batchSelected={batchSelected}
          />
          <KanbanColumn
            title={t('pendingDecision')}
            items={columns.pending}
            selected={selected}
            onSelect={batchMode ? toggleBatch : setSelected}
            accent="border-hcx-warning/60"
            batchMode={batchMode}
            batchSelected={batchSelected}
          />
          <KanbanColumn
            title={t('completedToday')}
            items={columns.done}
            selected={selected}
            onSelect={batchMode ? toggleBatch : setSelected}
            accent="border-hcx-success/60"
            batchMode={batchMode}
            batchSelected={batchSelected}
          />
        </div>

        {/* Detail panel */}
        {selected && selectedClaim && !batchMode && (
          <Card className="h-fit">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <div>
                <CardTitle className="font-mono text-base">
                  {selectedClaim.claim_id}
                </CardTitle>
                <div className="mt-1 flex items-center gap-2">
                  <ClaimStatusBadge status={selectedClaim.status} size="sm" />
                  <span className="text-xs text-hcx-text-muted">
                    {selectedClaim.provider_id}
                  </span>
                  {/* Fix #25: AI confidence score visible */}
                  {selectedClaim.ai_risk_score != null && (
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-semibold',
                        selectedClaim.ai_risk_score > 0.7
                          ? 'bg-hcx-danger/10 text-hcx-danger'
                          : selectedClaim.ai_risk_score > 0.4
                            ? 'bg-hcx-warning/10 text-hcx-warning'
                            : 'bg-hcx-success/10 text-hcx-success',
                      )}
                    >
                      AI Confidence: {((1 - selectedClaim.ai_risk_score) * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelected(null)}
                aria-label={tc('close')}
              >
                <X className="size-4" />
              </Button>
            </CardHeader>
            <Separator />
            <CardContent className="space-y-4 p-4">
              {/* AI Analysis Section */}
              <AIAnalysisPanel claim={selectedClaim} />

              <Separator />

              {/* Fix #28: Claim history */}
              <ClaimHistory claim={selectedClaim} />

              <Separator />

              {/* Decision Panel — Fix #26: Override with reason */}
              <DecisionPanel
                claim={selectedClaim}
                onSubmitted={() => setSelected(null)}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({
  title,
  items,
  selected,
  onSelect,
  accent,
  batchMode,
  batchSelected,
}: {
  title: string;
  items: ClaimSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  accent: string;
  batchMode?: boolean;
  batchSelected?: Set<string>;
}) {
  return (
    <div
      className={cn(
        'flex min-h-[200px] flex-col gap-2 rounded-lg border bg-card/40 p-2',
        accent,
      )}
    >
      <div className="flex items-center justify-between px-1 text-sm">
        <span className="font-semibold">{title}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-hcx-text-muted">
          {items.length}
        </span>
      </div>
      <div className="space-y-2">
        {items.map((c) => (
          <div key={c.claim_id} className="relative">
            {batchMode && (
              <div className="absolute top-2 left-2 z-10">
                <input
                  type="checkbox"
                  checked={batchSelected?.has(c.claim_id) ?? false}
                  onChange={() => onSelect(c.claim_id)}
                  className="size-4"
                />
              </div>
            )}
            <ClaimCard
              claim={c}
              active={selected === c.claim_id || (batchSelected?.has(c.claim_id) ?? false)}
              onClick={() => onSelect(c.claim_id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Fix #28: Claim history timeline */
function ClaimHistory({ claim }: { claim: ClaimSummary }) {
  const terminalStatuses = ['approved', 'denied', 'partial', 'settled', 'paid'];
  const pastAiReview = claim.status !== 'submitted' && claim.status !== 'under_ai_review';
  const pastPayer = terminalStatuses.includes(claim.status);
  const events = [
    { label: 'Submitted', date: claim.submitted_at, status: 'submitted' },
    ...(claim.status !== 'submitted'
      ? [{ label: 'Under AI Review', date: claim.submitted_at, status: 'under_ai_review' }]
      : []),
    ...(pastAiReview
      ? [{ label: 'Pending Payer Decision', date: claim.submitted_at, status: 'pending_payer_decision' }]
      : []),
    ...(pastPayer && claim.decided_at
      ? [{ label: `Payer Decision: ${claim.status}`, date: claim.decided_at, status: claim.status }]
      : []),
    ...(claim.status === 'paid' && claim.decided_at
      ? [{ label: 'Payment Completed', date: claim.decided_at, status: 'paid' }]
      : []),
  ];

  return (
    <div>
      <p className="text-sm font-semibold mb-2">Claim Timeline</p>
      <div className="space-y-2">
        {events.map((e, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="flex flex-col items-center">
              <div className="size-2.5 rounded-full bg-hcx-primary" />
              {i < events.length - 1 && <div className="h-4 w-0.5 bg-border" />}
            </div>
            <div className="flex-1 flex items-center justify-between">
              <span className="text-xs font-medium">{e.label}</span>
              <span className="text-xs text-hcx-text-muted">
                {new Date(e.date).toLocaleString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AIAnalysisPanel({ claim }: { claim: ClaimSummary }) {
  const t = useTranslations('ai');
  const [aiResult, setAiResult] = useState<AICoordinateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const bundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'Claim',
              id: claim.claim_id,
              type: { coding: [{ code: claim.claim_type }] },
              patient: { reference: `Patient/${claim.patient_nid_masked}` },
              provider: { reference: `Organization/${claim.provider_id}` },
              insurance: [
                { coverage: { reference: `Coverage/${claim.payer_id}` } },
              ],
              created: claim.submitted_at,
              total: { value: claim.total_amount, currency: 'EGP' },
            },
          },
        ],
      };
      const result = await api.coordinateClaim(bundle, {
        'X-HCX-Sender-Code': claim.provider_id,
        'X-HCX-Recipient-Code': claim.payer_id,
        'X-HCX-Correlation-ID': claim.correlation_id,
        'X-HCX-Workflow-ID': 'payer-review',
        'X-HCX-API-Call-ID': `review-${claim.claim_id}`,
      });
      setAiResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run AI analysis');
    } finally {
      setLoading(false);
    }
  }, [claim]);

  if (aiResult) {
    return <AIRecommendationCard analysis={aiResult} />;
  }

  return (
    <div className="space-y-3">
      {claim.ai_recommendation && (
        <div className="rounded-lg border border-hcx-primary/20 bg-hcx-primary-light/30 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('recommendationBadge')}</span>
            <span className="rounded-full bg-hcx-primary/10 px-2 py-0.5 text-xs font-semibold capitalize text-hcx-primary">
              {claim.ai_recommendation}
            </span>
          </div>
          {/* Fix #25: AI confidence score visible */}
          {claim.ai_risk_score != null && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-hcx-text-muted">
                <span>Risk Score</span>
                <span className="font-semibold">{(claim.ai_risk_score * 100).toFixed(0)}%</span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    claim.ai_risk_score > 0.7
                      ? 'bg-hcx-danger'
                      : claim.ai_risk_score > 0.4
                        ? 'bg-hcx-warning'
                        : 'bg-hcx-success',
                  )}
                  style={{ width: `${claim.ai_risk_score * 100}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-hcx-text-muted italic">
                This is an AI-generated recommendation. Final decision is made by a human reviewer.
              </p>
            </div>
          )}
        </div>
      )}

      <Button
        variant="outline"
        className="w-full"
        onClick={runAnalysis}
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Running AI Analysis...
          </>
        ) : (
          'Run Full AI Analysis'
        )}
      </Button>

      {error && (
        <p className="text-xs text-hcx-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type Decision = 'approve' | 'deny' | 'escalate';

/**
 * Fix #26: Decision panel with mandatory override reason when
 * disagreeing with AI recommendation.
 */
function DecisionPanel({
  claim,
  onSubmitted,
}: {
  claim: ClaimSummary;
  onSubmitted: () => void;
}) {
  const t = useTranslations('payer.queue');
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [notes, setNotes] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  // Fix #26: Check if human disagrees with AI
  const aiRecommendation = claim.ai_recommendation;
  const isOverride = useMemo(() => {
    if (!decision || !aiRecommendation) return false;
    const aiDecision =
      aiRecommendation === 'approved'
        ? 'approve'
        : aiRecommendation === 'denied'
          ? 'deny'
          : null;
    return aiDecision !== null && aiDecision !== decision;
  }, [decision, aiRecommendation]);

  const submit = useMutation({
    mutationFn: async () => {
      if (!decision) return null;
      // Fix #26: Require override reason
      if (isOverride && !overrideReason.trim()) {
        throw new Error('Override reason is required when disagreeing with AI recommendation.');
      }
      const humanDecision =
        decision === 'approve'
          ? 'approved'
          : decision === 'deny'
            ? 'denied'
            : 'investigating';
      // Also record feedback for drift monitoring
      api.submitFeedback({
        correlation_id: claim.correlation_id,
        ai_decision: claim.ai_recommendation ?? 'pended',
        human_decision: humanDecision,
        ai_score: claim.ai_risk_score ?? undefined,
        override_reason: isOverride ? overrideReason : undefined,
        notes: notes || undefined,
      }).catch(() => {}); // non-blocking

      // Submit the actual payer decision
      return api.submitClaimDecision({
        correlation_id: claim.correlation_id,
        decision: humanDecision === 'investigating' ? 'denied' : (humanDecision as 'approved' | 'denied'),
        reason: isOverride ? overrideReason : (notes || undefined),
        notes: notes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payer', 'claims'] });
      setDecision(null);
      setNotes('');
      setOverrideReason('');
      onSubmitted();
    },
  });

  const onClickDecision = useCallback((next: Decision) => setDecision(next), []);

  return (
    <div className="sticky bottom-0 space-y-3 rounded-lg border border-border bg-card p-3">
      <p className="text-sm font-semibold text-hcx-text">{t('decisionPanel')}</p>
      <div className="grid grid-cols-3 gap-2">
        <Button
          variant={decision === 'approve' ? 'success' : 'outline'}
          onClick={() => onClickDecision('approve')}
        >
          {t('approve')}
        </Button>
        <Button
          variant={decision === 'deny' ? 'destructive' : 'outline'}
          onClick={() => onClickDecision('deny')}
        >
          {t('deny')}
        </Button>
        <Button
          variant={decision === 'escalate' ? 'default' : 'outline'}
          onClick={() => onClickDecision('escalate')}
        >
          {t('escalate')}
        </Button>
      </div>

      {/* Fix #26: Override reason when disagreeing with AI */}
      {isOverride && (
        <div className="rounded-md border border-hcx-warning/50 bg-hcx-warning/5 p-3">
          <p className="text-xs font-semibold text-hcx-warning mb-1">
            You are overriding the AI recommendation ({aiRecommendation}). Please provide a reason:
          </p>
          <textarea
            rows={2}
            placeholder="Mandatory: Explain why you disagree with the AI recommendation..."
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            className="w-full rounded-md border border-hcx-warning/30 bg-background p-2 text-sm"
            required
          />
        </div>
      )}

      <textarea
        rows={2}
        placeholder={t('notes')}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="w-full rounded-md border border-input bg-background p-2 text-sm"
      />
      {submit.isError && (
        <p className="text-xs text-hcx-danger" role="alert">
          {(submit.error as Error).message}
        </p>
      )}
      <Button
        className="w-full"
        disabled={!decision || submit.isPending || (isOverride && !overrideReason.trim())}
        onClick={() => submit.mutate()}
        aria-busy={submit.isPending}
      >
        {submit.isPending ? '...' : t('submitDecision')}
      </Button>
    </div>
  );
}
