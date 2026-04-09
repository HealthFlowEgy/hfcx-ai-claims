'use client';

import { useTranslations } from 'next-intl';
import { MessageSquare } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/utils';

type Thread = {
  id: string;
  subject: string;
  claim_id: string;
  provider: string;
  sent_at: string;
  awaiting_response: boolean;
};

const SEED: Thread[] = [
  {
    id: 't-1',
    subject: 'Operative notes requested',
    claim_id: 'CLAIM-2026-0042',
    provider: 'Kasr El Aini Hospital',
    sent_at: new Date(Date.now() - 3 * 3600000).toISOString(),
    awaiting_response: true,
  },
  {
    id: 't-2',
    subject: 'Clarify secondary CPT',
    claim_id: 'CLAIM-2026-0038',
    provider: 'Alexandria Medical Center',
    sent_at: new Date(Date.now() - 86400000).toISOString(),
    awaiting_response: false,
  },
  {
    id: 't-3',
    subject: 'Supporting lab results needed',
    claim_id: 'CLAIM-2026-0035',
    provider: 'Luxor Clinic',
    sent_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    awaiting_response: true,
  },
];

export default function PayerCommunicationsPage() {
  const t = useTranslations('payer.communications');
  const tLoc = useTranslations('common');
  const locale = (typeof document !== 'undefined' &&
    document.documentElement.lang) as 'ar' | 'en';

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      <div className="space-y-3">
        {SEED.map((th) => (
          <Card key={th.id}>
            <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-hcx-primary-light/60 p-2 text-hcx-primary">
                  <MessageSquare className="size-5" aria-hidden />
                </div>
                <div>
                  <CardTitle className="text-base">{th.subject}</CardTitle>
                  <p className="text-xs text-hcx-text-muted">
                    {th.provider} · {th.claim_id}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {th.awaiting_response && (
                  <Badge variant="warning">{tLoc('loading')}</Badge>
                )}
                <span className="text-xs text-hcx-text-muted">
                  {formatDate(th.sent_at, locale === 'ar' ? 'ar' : 'en')}
                </span>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
