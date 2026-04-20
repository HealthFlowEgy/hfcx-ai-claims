'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, MessageSquare, Send } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

type Message = {
  id: string;
  from_name: string;
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

export default function ProviderCommunicationsPage() {
  const t = useTranslations('provider.communications');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string>('');
  const [draft, setDraft] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['provider', 'communications'],
    queryFn: () => api.providerCommunications(),
  });

  const threads: Thread[] = (data?.threads ?? []).map((th) => ({
    ...th,
    messages: th.messages.map((m) => ({
      ...m,
    })),
  }));

  // Select first thread if nothing selected yet
  const selectedId = activeId || threads[0]?.id || '';
  const active = threads.find((t) => t.id === selectedId);

  // ISSUE-049: Persist replies to backend instead of local state only
  const replyMutation = useMutation({
    mutationFn: async ({ threadId, body }: { threadId: string; body: string }) => {
      const resp = await fetch(
        `/api/proxy/internal/ai/bff/provider/communications/${threadId}/reply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        },
      );
      if (!resp.ok) throw new Error('Reply failed');
      return resp.json();
    },
    onSuccess: () => {
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['provider', 'communications'] });
      toast({
        variant: 'success',
        title: t('replySent'),
        description: t('replySuccess'),
      });
    },
    onError: () => {
      toast({
        variant: 'destructive',
        title: tc('error'),
        description: 'Failed to send reply. Please try again.',
      });
    },
  });

  const send = () => {
    if (!active || !draft.trim()) return;
    replyMutation.mutate({ threadId: active.id, body: draft.trim() });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <p className="text-sm text-hcx-text-muted">{tc('loading')}</p>
      </div>
    );
  }

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
                  selectedId === th.id && 'bg-hcx-primary-light/60',
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
                  <span className="font-semibold">{m.from_name}</span>
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
                  <Button
                    onClick={send}
                    disabled={!draft.trim() || replyMutation.isPending}
                  >
                    {replyMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Send className="size-4" aria-hidden />
                    )}
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
