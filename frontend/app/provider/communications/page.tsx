'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { MessageSquare, Send } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatDate } from '@/lib/utils';

type Message = {
  id: string;
  from: string;
  direction: 'inbound' | 'outbound';
  body: string;
  sent_at: string;
};

type Thread = {
  id: string;
  subject: string;
  payer: string;
  claim_id: string;
  unread: boolean;
  messages: Message[];
};

const SEED_THREADS: Thread[] = [
  {
    id: 't-1',
    subject: 'Additional documentation requested',
    payer: 'Misr Insurance',
    claim_id: 'CLAIM-2026-0042',
    unread: true,
    messages: [
      {
        id: 'm-1',
        from: 'Misr Insurance',
        direction: 'inbound',
        body: 'Please provide the operative notes and radiology report for this claim before we can proceed.',
        sent_at: new Date(Date.now() - 3 * 3600000).toISOString(),
      },
    ],
  },
  {
    id: 't-2',
    subject: 'Pre-auth clarification',
    payer: 'Allianz Egypt',
    claim_id: 'CLAIM-2026-0038',
    unread: false,
    messages: [
      {
        id: 'm-2',
        from: 'Allianz Egypt',
        direction: 'inbound',
        body: 'Kindly confirm the CPT code for the secondary procedure.',
        sent_at: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        id: 'm-3',
        from: 'Provider',
        direction: 'outbound',
        body: 'Confirmed — the secondary procedure is CPT 99215. Full chart attached.',
        sent_at: new Date(Date.now() - 12 * 3600000).toISOString(),
      },
    ],
  },
];

export default function ProviderCommunicationsPage() {
  const t = useTranslations('provider.communications');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const [activeId, setActiveId] = useState<string>(SEED_THREADS[0]?.id ?? '');
  const [draft, setDraft] = useState('');
  const [threads, setThreads] = useState(SEED_THREADS);
  const active = threads.find((t) => t.id === activeId);

  const send = () => {
    if (!active || !draft.trim()) return;
    setThreads((prev) =>
      prev.map((th) =>
        th.id === active.id
          ? {
              ...th,
              messages: [
                ...th.messages,
                {
                  id: `m-${Date.now()}`,
                  from: 'Provider',
                  direction: 'outbound',
                  body: draft,
                  sent_at: new Date().toISOString(),
                },
              ],
            }
          : th,
      ),
    );
    setDraft('');
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        {/* Thread list */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="size-4" aria-hidden />
              {t('title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            {threads.map((th) => (
              <button
                key={th.id}
                type="button"
                onClick={() => setActiveId(th.id)}
                className={cn(
                  'w-full rounded-md p-3 text-start transition-colors hover:bg-accent',
                  activeId === th.id && 'bg-hcx-primary-light/60',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold">
                    {th.subject}
                  </span>
                  {th.unread && (
                    <Badge variant="default" className="text-[10px]">
                      new
                    </Badge>
                  )}
                </div>
                <div className="mt-1 text-xs text-hcx-text-muted">
                  {th.payer} · {th.claim_id}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Active thread */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {active?.subject ?? t('noThreads')}
            </CardTitle>
            {active && (
              <p className="text-xs text-hcx-text-muted">
                {t('from')}: {active.payer}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {!active && (
              <p className="text-sm text-hcx-text-muted">{tc('noData')}</p>
            )}
            {active?.messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'rounded-lg border border-border p-3 text-sm',
                  m.direction === 'outbound'
                    ? 'ms-8 bg-hcx-primary-light/40'
                    : 'me-8 bg-muted/40',
                )}
              >
                <div className="mb-1 flex items-center justify-between text-xs text-hcx-text-muted">
                  <span className="font-semibold">{m.from}</span>
                  <span>{formatDate(m.sent_at, locale)}</span>
                </div>
                <p className="leading-relaxed">{m.body}</p>
              </div>
            ))}
            {active && (
              <div className="space-y-2 pt-2">
                <textarea
                  rows={3}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t('reply')}
                  className="w-full rounded-md border border-input bg-background p-2 text-sm"
                />
                <div className="flex justify-end">
                  <Button onClick={send} disabled={!draft.trim()}>
                    <Send className="size-4" aria-hidden />
                    {t('reply')}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
