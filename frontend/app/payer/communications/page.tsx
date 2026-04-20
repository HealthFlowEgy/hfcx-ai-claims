'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { MessageSquare } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

type Thread = {
  id: string;
  subject: string;
  claim_id: string;
  provider: string;
  sent_at: string;
  awaiting_response: boolean;
};

export default function PayerCommunicationsPage() {
  const t = useTranslations('payer.communications');
  const tLoc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';

  const { data, isLoading } = useQuery({
    queryKey: ['payer', 'communications'],
    queryFn: () => api.payerCommunications(),
  });

  const threads: Thread[] = data?.threads ?? [];

  if (isLoading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <p className="text-sm text-hcx-text-muted">{tLoc('loading')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      <div className="space-y-3">
        {threads.map((th) => (
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
                  {/* ISSUE-030: Use correct label instead of 'Loading...' */}
                  <Badge variant="warning">{t('awaitingResponse')}</Badge>
                )}
                <span className="text-xs text-hcx-text-muted">
                  {formatDate(th.sent_at, locale)}
                </span>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
