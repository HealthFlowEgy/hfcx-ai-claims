'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Clock, Inbox, ShieldCheck, Timer } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/shared/kpi-card';
import { api } from '@/lib/api';

export default function PayerDashboardPage() {
  const t = useTranslations('payer.dashboard');
  const tq = useTranslations('payer.queue');

  const { data } = useQuery({
    queryKey: ['payer', 'summary'],
    queryFn: () => api.payerSummary(),
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
      <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t('queueDepth')}
          value={s.queue_depth}
          icon={<Inbox className="size-5" />}
          threshold={{ warn: 50, alert: 100, higherIsBad: true }}
        />
        <KpiCard
          label={t('approvalRate')}
          value={`${(s.approval_rate * 100).toFixed(1)}%`}
          icon={<ShieldCheck className="size-5" />}
        />
        <KpiCard
          label={t('pendingPreAuth')}
          value={s.pending_preauth}
          icon={<Clock className="size-5" />}
        />
        <KpiCard
          label={t('avgProcessingTime')}
          value={`${s.avg_processing_minutes.toFixed(0)}m`}
          icon={<Timer className="size-5" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tq('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-hcx-text-muted">
            {/* Lightweight call-to-action — the real kanban lives at /payer/claims */}
            Open the Claims Queue to start reviewing AI-analyzed claims with
            recommendations, per SRS §5.2.1.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
