'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Banknote, CheckCircle2, Search } from 'lucide-react';

import { KpiCard } from '@/components/shared/kpi-card';
import { api } from '@/lib/api';
import { formatEgp } from '@/lib/utils';

export default function SiuDashboardPage() {
  const t = useTranslations('siu.dashboard');
  const locale = useLocale() as 'ar' | 'en';

  const { data } = useQuery({
    queryKey: ['siu', 'summary'],
    queryFn: () => api.siuSummary(),
  });

  const s = data ?? {
    flagged_total: 0,
    open_investigations: 0,
    resolved_cases: 0,
    fraud_savings_egp: 0,
    risk_distribution: [],
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t('flaggedTotal')}
          value={s.flagged_total}
          icon={<AlertTriangle className="size-5" />}
        />
        <KpiCard
          label={t('openInvestigations')}
          value={s.open_investigations}
          icon={<Search className="size-5" />}
        />
        <KpiCard
          label={t('resolvedCases')}
          value={s.resolved_cases}
          icon={<CheckCircle2 className="size-5" />}
        />
        <KpiCard
          label={t('fraudSavings')}
          value={formatEgp(s.fraud_savings_egp, locale)}
          icon={<Banknote className="size-5" />}
        />
      </div>
    </div>
  );
}
