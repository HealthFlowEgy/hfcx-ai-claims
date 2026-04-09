'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ClaimCard } from '@/components/shared/claim-card';
import { ClaimStatusBadge } from '@/components/shared/claim-status-badge';
import { api } from '@/lib/api';
import type { ClaimStatus, ClaimSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * SRS §5.2.1 — Payer Claims Queue (Kanban + detail panel).
 *
 * 80%+ of reviewer time lives here. Four columns map to the core
 * workflow states; clicking a card opens a right-side detail panel
 * with the AIRecommendationCard and the decision form.
 */

const COLUMN_STATUSES: Record<string, ClaimStatus[]> = {
  new: ['submitted'],
  ai: ['ai_analyzed'],
  pending: ['in_review'],
  done: ['approved', 'denied', 'settled'],
};

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
      done: items.filter((c) => COLUMN_STATUSES.done.includes(c.status)),
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
              {/* The list endpoint returns the summary without AI details;
                  a real review page would fetch /internal/ai/bff/claims/{id}.
                  We surface a placeholder banner explaining that. */}
              <p className="text-xs text-hcx-text-muted">
                Full AI analysis loads via GET /internal/ai/bff/claims/{selectedClaim.claim_id}
                — wire in the next iteration. The queue card already surfaces
                the recommendation + risk bar.
              </p>
              <DecisionPanel />
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

function DecisionPanel() {
  const t = useTranslations('payer.queue');
  const [decision, setDecision] = useState<'approve' | 'deny' | 'escalate' | null>(
    null,
  );

  return (
    <div className="sticky bottom-0 space-y-3 rounded-lg border border-border bg-card p-3">
      <p className="text-sm font-semibold text-hcx-text">{t('decisionPanel')}</p>
      <div className="grid grid-cols-3 gap-2">
        <Button
          variant={decision === 'approve' ? 'success' : 'outline'}
          onClick={() => setDecision('approve')}
        >
          {t('approve')}
        </Button>
        <Button
          variant={decision === 'deny' ? 'destructive' : 'outline'}
          onClick={() => setDecision('deny')}
        >
          {t('deny')}
        </Button>
        <Button
          variant={decision === 'escalate' ? 'default' : 'outline'}
          onClick={() => setDecision('escalate')}
        >
          {t('escalate')}
        </Button>
      </div>
      <textarea
        rows={3}
        placeholder={t('notes')}
        className="w-full rounded-md border border-input bg-background p-2 text-sm"
      />
      <Button className="w-full" disabled={!decision}>
        {t('submitDecision')}
      </Button>
    </div>
  );
}
