'use client';

import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Clock, Inbox, ShieldCheck, Timer } from 'lucide-react';
import { useClaimUpdates } from '@/hooks/use-claim-updates';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/shared/kpi-card';
import { api } from '@/lib/api';

/**
 * Fix #23: Real-time queue depth with auto-refresh indicator and SSE
 * Fix #24: Clickable KPI cards navigating to respective modules
 */
export default function PayerDashboardPage() {
  const t = useTranslations('payer.dashboard');
  const tq = useTranslations('payer.queue');
  const router = useRouter();

  const queryClient = useQueryClient();

  // Fix #23: Real-time SSE — auto-refresh dashboard KPIs when AI finishes
  useClaimUpdates((event) => {
    if (event.status === 'completed' || event.status === 'failed') {
      queryClient.invalidateQueries({ queryKey: ['payer', 'summary'] });
    }
  });

  const { data, dataUpdatedAt } = useQuery({
    queryKey: ['payer', 'summary'],
    queryFn: () => api.payerSummary(),
    refetchInterval: 15_000, // Fix #23: Auto-refresh every 15s
  });

  const s = data ?? {
    queue_depth: 0,
    approval_rate: 0,
    pending_preauth: 0,
    avg_processing_minutes: 0,
    by_ai_recommendation: [],
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        {/* Fix #23: Real-time indicator */}
        {dataUpdatedAt > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-hcx-text-muted">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-hcx-success opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-hcx-success" />
            </span>
            Live — updated {new Date(dataUpdatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Fix #24: Clickable KPI cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t('queueDepth')}
          value={s.queue_depth}
          icon={<Inbox className="size-5" />}
          threshold={{ warn: 50, alert: 100, higherIsBad: true }}
          onClick={() => router.push('/payer/claims')}
        />
        <KpiCard
          label={t('approvalRate')}
          value={`${(s.approval_rate * 100).toFixed(1)}%`}
          icon={<ShieldCheck className="size-5" />}
          onClick={() => router.push('/payer/analytics')}
        />
        <KpiCard
          label={t('pendingPreAuth')}
          value={s.pending_preauth}
          icon={<Clock className="size-5" />}
          onClick={() => router.push('/payer/preauth')}
        />
        <KpiCard
          label={t('avgProcessingTime')}
          value={`${s.avg_processing_minutes.toFixed(0)}m`}
          icon={<Timer className="size-5" />}
          onClick={() => router.push('/payer/analytics')}
        />
      </div>

      {/* AI Recommendation breakdown */}
      {s.by_ai_recommendation.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>AI Recommendation Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {s.by_ai_recommendation.map((r) => (
                <div
                  key={r.recommendation}
                  className="rounded-lg border border-border p-3 text-center"
                >
                  <p className="text-xs uppercase text-hcx-text-muted">
                    {r.recommendation}
                  </p>
                  <p className="mt-1 text-xl font-bold tabular-nums">
                    {r.count}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="cursor-pointer hover:border-hcx-primary transition-colors" onClick={() => router.push('/payer/claims')}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-hcx-warning" />
            {tq('title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-hcx-text-muted">
            {s.queue_depth > 0
              ? `${s.queue_depth} claims are waiting for review. Click to open the Claims Queue.`
              : 'No claims pending review. Click to view the Claims Queue.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
