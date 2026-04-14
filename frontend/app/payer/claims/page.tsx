'use client';

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Loader2, X } from 'lucide-react';

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
 * 80%+ of reviewer time lives here. Four columns map to the core
 * workflow states; clicking a card opens a right-side detail panel
 * with the AI analysis results and the decision form.
 */

const COLUMN_STATUSES: Record<string, ClaimStatus[]> = {
  new: ['submitted'],
  ai: ['ai_analyzed'],
  pending: ['in_review'],
  done: ['approved', 'denied', 'settled'],
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

  const [selected, setSelected] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['payer', 'claims'],
    queryFn: () =>
      api.listClaims({ portal: 'payer', limit: 200 }),
  });

  const columns = useMemo(() => {
    const items = data?.items ?? [];
    return {
      new: items.filter((c) => COLUMN_STATUSES.new.includes(c.status)),
      ai: items.filter((c) => COLUMN_STATUSES.ai.includes(c.status)),
      pending: items.filter((c) => COLUMN_STATUSES.pending.includes(c.status)),
      // Fix: only show claims decided TODAY in the "Completed Today" column.
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

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
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
            onSelect={setSelected}
            accent="border-hcx-primary/40"
          />
          <KanbanColumn
            title={t('aiReviewed')}
            items={columns.ai}
            selected={selected}
            onSelect={setSelected}
            accent="border-hcx-primary/60"
          />
          <KanbanColumn
            title={t('pendingDecision')}
            items={columns.pending}
            selected={selected}
            onSelect={setSelected}
            accent="border-hcx-warning/60"
          />
          <KanbanColumn
            title={t('completedToday')}
            items={columns.done}
            selected={selected}
            onSelect={setSelected}
            accent="border-hcx-success/60"
          />
        </div>

        {/* Detail panel */}
        {selected && selectedClaim && (
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

              {/* Decision Panel */}
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
}: {
  title: string;
  items: ClaimSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  accent: string;
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
          <ClaimCard
            key={c.claim_id}
            claim={c}
            active={selected === c.claim_id}
            onClick={() => onSelect(c.claim_id)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Fetches and displays the full AI adjudication analysis for a selected claim.
 * Uses the claim's correlation_id to re-run the coordinate endpoint.
 */
function AIAnalysisPanel({ claim }: { claim: ClaimSummary }) {
  const t = useTranslations('ai');
  const [aiResult, setAiResult] = useState<AICoordinateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Build a minimal FHIR bundle from the claim summary for re-analysis
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
      {/* Show existing AI summary from the claim list */}
      {claim.ai_recommendation && (
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
                <span>{(claim.ai_risk_score * 100).toFixed(0)}%</span>
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
            </div>
          )}
        </div>
      )}

      {/* Run full AI analysis button */}
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

  const submit = useMutation({
    mutationFn: async () => {
      if (!decision) return null;
      const humanDecision =
        decision === 'approve'
          ? 'approved'
          : decision === 'deny'
          ? 'denied'
          : 'investigating';
      return api.submitFeedback({
        correlation_id: claim.correlation_id,
        ai_decision: claim.ai_recommendation ?? 'pended',
        human_decision: humanDecision,
        ai_score: claim.ai_risk_score ?? undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payer', 'claims'] });
      setDecision(null);
      setNotes('');
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
      <textarea
        rows={3}
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
        disabled={!decision || submit.isPending}
        onClick={() => submit.mutate()}
        aria-busy={submit.isPending}
      >
        {submit.isPending ? '…' : t('submitDecision')}
      </Button>
    </div>
  );
}
