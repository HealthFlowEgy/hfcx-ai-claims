'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { api, normalizeClaimDetail } from '@/lib/api';
import type { ClaimDetailPayload } from '@/lib/api';
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
  pending: ['in_review', 'pending_payer_decision', 'investigating'],
  done: ['approved', 'denied', 'partial', 'settled', 'paid', 'voided'],
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
    // BUG-10: Deduplicate by claim_id — keep the latest (most complete) entry
    // to prevent optimistic placeholder + real record from both appearing.
    const raw = data?.items ?? [];
    const seen = new Map<string, ClaimSummary>();
    for (const c of raw) {
      const existing = seen.get(c.claim_id);
      if (!existing || (c.ai_risk_score != null && existing.ai_risk_score == null)) {
        seen.set(c.claim_id, c);
      }
    }
    const items = Array.from(seen.values());
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
          'grid gap-5 transition-all',
          selected ? 'grid-cols-1 lg:grid-cols-[1fr_2fr]' : 'grid-cols-1',
        )}
      >
        {/* Kanban */}
        <div className={cn(
          'grid min-w-0 gap-3',
          selected
            ? 'grid-cols-1 md:grid-cols-2'
            : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4',
        )}>
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
          <div className="h-fit space-y-4">
            {/* Claim header card */}
            <Card className="overflow-hidden border-0 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-sm font-bold text-slate-800">
                      {selectedClaim.claim_id}
                    </span>
                    <ClaimStatusBadge status={selectedClaim.status} size="sm" />
                  </div>
                  <div className="flex items-center gap-3 text-[12px] text-slate-500">
                    <span>{selectedClaim.provider_id}</span>
                    {selectedClaim.ai_risk_score != null && (
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          selectedClaim.ai_risk_score > 0.7
                            ? 'bg-red-50 text-red-600'
                            : selectedClaim.ai_risk_score > 0.4
                              ? 'bg-amber-50 text-amber-600'
                              : 'bg-emerald-50 text-emerald-600',
                        )}
                      >
                        Risk: {(selectedClaim.ai_risk_score * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelected(null)}
                  aria-label={tc('close')}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </Card>

            {/* AI Analysis */}
            <AIAnalysisPanel claim={selectedClaim} />

            {/* Claim history */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <ClaimHistory claim={selectedClaim} />
              </CardContent>
            </Card>

            {/* Decision Panel */}
            <DecisionPanel
              claim={selectedClaim}
              onSubmitted={() => setSelected(null)}
            />
          </div>
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
        'flex min-h-[180px] flex-col gap-1.5 rounded-xl border bg-slate-50/80 p-2',
        accent,
      )}
    >
      <div className="flex items-center justify-between px-1 py-1">
        <span className="text-[12px] font-bold uppercase tracking-wider text-slate-500">
          {title}
        </span>
        <span className="flex size-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">
          {items.length}
        </span>
      </div>
      <div className="space-y-1.5">
        {items.map((c) => (
          <div key={c.claim_id} className="relative">
            {batchMode && (
              <div className="absolute top-2 start-2 z-10">
                <input
                  type="checkbox"
                  checked={batchSelected?.has(c.claim_id) ?? false}
                  onChange={() => onSelect(c.claim_id)}
                  className="size-4 accent-hcx-primary"
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
  const [claimDetail, setClaimDetail] = useState<ClaimDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [polling, setPolling] = useState(false);

  // BUG-03 + FEAT-02: Auto-fetch persisted AI analysis on mount.
  // If status is 'under_ai_review', auto-poll every 5s until analysis completes.
  useEffect(() => {
    if (!claim.correlation_id) return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const fetchDetail = async () => {
      try {
        const data = await api.claimDetail(claim.correlation_id);
        if (cancelled) return;
        setClaimDetail(data);
        // Stop polling once we have analysis results (status is no longer under_ai_review)
        const status = data?.status ?? data?.ai_recommendation;
        if (status && status !== 'under_ai_review') {
          setPolling(false);
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }
      } catch {
        // ignore fetch errors during polling
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };

    setDetailLoading(true);
    fetchDetail();

    // BUG-03: If claim is still under AI review, poll every 5 seconds
    if (claim.status === 'under_ai_review' || claim.status === 'submitted') {
      setPolling(true);
      intervalId = setInterval(fetchDetail, 5000);
    }

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [claim.correlation_id, claim.status]);

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

  // If manual run produced a result, show it directly
  if (aiResult) {
    return <AIRecommendationCard analysis={aiResult} />;
  }

  // FEAT-02: Normalize claimDetail into AICoordinateResponse for AIRecommendationCard
  // Uses the typed normalizeClaimDetail() which correctly maps _result suffix keys.
  const normalizedAiData: AICoordinateResponse | null = claimDetail
    ? normalizeClaimDetail(claimDetail)
    : null;

  return (
    <div className="space-y-3">
      {/* BUG-03: Show pulsing skeleton when AI analysis is still in progress */}
      {polling && (
        <div className="flex items-center gap-2 rounded-lg border border-hcx-primary/20 bg-hcx-primary-light/20 p-3">
          <Loader2 className="size-4 animate-spin text-hcx-primary" />
          <div>
            <p className="text-sm font-medium text-hcx-primary">AI analysis in progress...</p>
            <p className="text-xs text-hcx-text-muted">Results will appear automatically when ready.</p>
          </div>
        </div>
      )}

      {detailLoading && !polling && (
        <div className="flex items-center gap-2 text-xs text-hcx-text-muted">
          <Loader2 className="size-3 animate-spin" /> Loading AI analysis details...
        </div>
      )}

      {/* FEAT-02: Render claimDetail through AIRecommendationCard instead of flat key/value dump */}
      {normalizedAiData && normalizedAiData.overall_confidence > 0 && (
        <AIRecommendationCard analysis={normalizedAiData} />
      )}

      {/* Fallback: show recommendation badge if no full analysis yet */}
      {!normalizedAiData && claim.ai_recommendation && (
        <div className="rounded-lg border border-hcx-primary/20 bg-hcx-primary-light/30 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('recommendationBadge')}</span>
            <span className="rounded-full bg-hcx-primary/10 px-2 py-0.5 text-xs font-semibold capitalize text-hcx-primary">
              {claim.ai_recommendation}
            </span>
          </div>
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
          (normalizedAiData || claimDetail) ? 'Re-run Full AI Analysis' : 'Run Full AI Analysis'
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
            : 'escalate_siu';
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
        decision: humanDecision as 'approved' | 'denied' | 'escalate_siu',
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
    <Card className="sticky bottom-0 overflow-hidden border-0 shadow-sm">
    <div className="space-y-3 p-4">
      <p className="text-[12px] font-bold uppercase tracking-wider text-slate-500">{t('decisionPanel')}</p>
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
        className="w-full bg-gradient-to-r from-hcx-primary to-hcx-primary/80 text-white hover:from-hcx-primary/90 hover:to-hcx-primary/70"
        disabled={!decision || submit.isPending || (isOverride && !overrideReason.trim())}
        onClick={() => submit.mutate()}
        aria-busy={submit.isPending}
      >
        {submit.isPending ? '...' : t('submitDecision')}
      </Button>
    </div>
    </Card>
  );
}
