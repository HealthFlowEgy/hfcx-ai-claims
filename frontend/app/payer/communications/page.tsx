'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, MessageSquare, Send } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

/**
 * Fix #35: Message threading with expandable thread view,
 * reply functionality, and unread indicator.
 */

type Thread = {
  id: string;
  subject: string;
  claim_id: string;
  provider: string;
  sent_at: string;
  awaiting_response: boolean;
  messages?: { sender: string; body: string; sent_at: string }[];
};

export default function PayerCommunicationsPage() {
  const t = useTranslations('payer.communications');
  const tLoc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const queryClient = useQueryClient();

  const [expandedThread, setExpandedThread] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [filter, setFilter] = useState<'all' | 'awaiting'>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['payer', 'communications'],
    queryFn: () => api.payerCommunications(),
  });

  const threads: Thread[] = (data?.threads ?? []).filter((th: Thread) => {
    if (filter === 'awaiting') return th.awaiting_response;
    return true;
  });

  // Reply mutation
  const replyMutation = useMutation({
    mutationFn: async ({ threadId, body }: { threadId: string; body: string }) => {
      const resp = await fetch(`/api/proxy/internal/ai/bff/payer/communications/${threadId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!resp.ok) throw new Error('Reply failed');
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payer', 'communications'] });
      setReplyText('');
      toast({ title: 'Reply Sent', variant: 'success' });
    },
    onError: () => {
      toast({ title: 'Failed to send reply', variant: 'destructive' });
    },
  });

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

      {/* Filter */}
      <div className="flex gap-2">
        <button
          onClick={() => setFilter('all')}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-medium transition-colors',
            filter === 'all' ? 'bg-hcx-primary text-white' : 'bg-muted text-hcx-text-muted hover:bg-accent',
          )}
        >
          All ({data?.threads?.length ?? 0})
        </button>
        <button
          onClick={() => setFilter('awaiting')}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-medium transition-colors',
            filter === 'awaiting' ? 'bg-hcx-warning text-white' : 'bg-muted text-hcx-text-muted hover:bg-accent',
          )}
        >
          Awaiting Response ({(data?.threads ?? []).filter((th: Thread) => th.awaiting_response).length})
        </button>
      </div>

      <div className="space-y-3">
        {threads.map((th) => {
          const isExpanded = expandedThread === th.id;
          // Generate mock thread messages if not provided by API
          const messages = th.messages ?? [
            {
              sender: th.provider,
              body: `Regarding ${th.subject} for claim ${th.claim_id}`,
              sent_at: th.sent_at,
            },
          ];

          return (
            <Card key={th.id} className={cn(isExpanded && 'border-hcx-primary')}>
              <CardHeader
                className="flex flex-row items-center justify-between gap-3 pb-3 cursor-pointer"
                onClick={() => setExpandedThread(isExpanded ? null : th.id)}
              >
                <div className="flex items-center gap-3">
                  <div className="relative rounded-lg bg-hcx-primary-light/60 p-2 text-hcx-primary">
                    <MessageSquare className="size-5" aria-hidden />
                    {th.awaiting_response && (
                      <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-hcx-warning" />
                    )}
                  </div>
                  <div>
                    <CardTitle className="text-base">{th.subject}</CardTitle>
                    <p className="text-xs text-hcx-text-muted">
                      {th.provider} · {th.claim_id} · {messages.length} message{messages.length > 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {th.awaiting_response && (
                    <Badge variant="warning">{t('awaitingResponse')}</Badge>
                  )}
                  <span className="text-xs text-hcx-text-muted">
                    {formatDate(th.sent_at, locale)}
                  </span>
                  {isExpanded ? (
                    <ChevronUp className="size-4 text-hcx-text-muted" />
                  ) : (
                    <ChevronDown className="size-4 text-hcx-text-muted" />
                  )}
                </div>
              </CardHeader>

              {/* Fix #35: Expandable thread view */}
              {isExpanded && (
                <CardContent className="space-y-3 pt-0">
                  {/* Message thread */}
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {messages.map((msg, i) => (
                      <div
                        key={i}
                        className={cn(
                          'rounded-lg p-3 text-sm',
                          msg.sender === 'Payer'
                            ? 'bg-hcx-primary/5 ml-8'
                            : 'bg-muted mr-8',
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold">{msg.sender}</span>
                          <span className="text-[10px] text-hcx-text-muted">
                            {formatDate(msg.sent_at, locale)}
                          </span>
                        </div>
                        <p className="text-sm">{msg.body}</p>
                      </div>
                    ))}
                  </div>

                  {/* Reply form */}
                  <div className="flex gap-2">
                    <textarea
                      rows={2}
                      placeholder="Type your reply..."
                      value={expandedThread === th.id ? replyText : ''}
                      onChange={(e) => setReplyText(e.target.value)}
                      className="flex-1 rounded-md border border-input bg-background p-2 text-sm"
                    />
                    <Button
                      size="icon"
                      onClick={() => {
                        if (replyText.trim()) {
                          replyMutation.mutate({ threadId: th.id, body: replyText });
                        }
                      }}
                      disabled={!replyText.trim() || replyMutation.isPending}
                    >
                      <Send className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}

        {threads.length === 0 && (
          <p className="text-center text-sm text-hcx-text-muted py-8">
            No messages found.
          </p>
        )}
      </div>
    </div>
  );
}
