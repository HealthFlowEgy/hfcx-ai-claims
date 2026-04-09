'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, FileText, Sparkles } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn, formatDate, formatEgp } from '@/lib/utils';

/**
 * SRS §4.2.5 — Denials & Appeals.
 * FR-PP-DEN-001: denied claims grouped by denial reason.
 * FR-PP-DEN-002: AI-generated appeal guidance per claim.
 * FR-PP-DEN-003: pre-drafted appeal form + submit.
 */
export default function ProviderDenialsPage() {
  const t = useTranslations('provider.denials');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [appealClaimId, setAppealClaimId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['provider', 'denials'],
    queryFn: () => api.providerDenials(),
  });

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    if (!selectedCategory) return items;
    return items.filter((i) => i.reason === selectedCategory);
  }, [data, selectedCategory]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      {/* Category cards */}
      <Card>
        <CardHeader>
          <CardTitle>{t('categories')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-hcx-text-muted">{tc('loading')}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(data?.categories ?? []).map((cat) => (
                <button
                  key={cat.category}
                  type="button"
                  onClick={() =>
                    setSelectedCategory(
                      selectedCategory === cat.category ? null : cat.category,
                    )
                  }
                  className={cn(
                    'rounded-lg border p-4 text-start transition-colors',
                    selectedCategory === cat.category
                      ? 'border-hcx-primary bg-hcx-primary-light/60'
                      : 'border-border hover:bg-accent',
                  )}
                >
                  <div className="text-xs uppercase text-hcx-text-muted">
                    {cat.category}
                  </div>
                  <div className="mt-1 text-2xl font-bold tabular-nums">
                    {cat.count}
                  </div>
                  <div className="mt-1 text-xs text-hcx-text-muted">
                    {formatEgp(cat.total_egp, locale)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Denied claim list */}
      <div className="space-y-4">
        {filtered.map((claim) => (
          <Card key={claim.claim_id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-hcx-danger/10 p-2 text-hcx-danger">
                  <AlertTriangle className="size-5" aria-hidden />
                </div>
                <div>
                  <CardTitle className="font-mono text-base">
                    {claim.claim_id}
                  </CardTitle>
                  <p className="text-xs text-hcx-text-muted">
                    {claim.claim_type} ·{' '}
                    {formatEgp(claim.total_amount, locale)} ·{' '}
                    {t('deniedOn')} {formatDate(claim.denied_on, locale)}
                  </p>
                </div>
              </div>
              <Button
                variant="default"
                onClick={() =>
                  setAppealClaimId(
                    appealClaimId === claim.claim_id ? null : claim.claim_id,
                  )
                }
              >
                <FileText className="size-4" aria-hidden />
                {t('appealAction')}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <Alert variant="destructive">
                <AlertTitle>{t('reason')}</AlertTitle>
                <AlertDescription>{claim.reason}</AlertDescription>
              </Alert>
              <Alert variant="info">
                <Sparkles className="size-4" aria-hidden />
                <AlertTitle>{t('aiSummary')}</AlertTitle>
                <AlertDescription>{claim.ai_appeal_summary}</AlertDescription>
              </Alert>
              {appealClaimId === claim.claim_id && (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <label className="text-xs font-semibold text-hcx-text">
                    {t('attachDocs')}
                  </label>
                  <input
                    type="file"
                    multiple
                    className="block w-full text-sm"
                    aria-label={t('attachDocs')}
                  />
                  <Button variant="success" size="sm">
                    {t('submitAppeal')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && !isLoading && (
          <p className="text-sm text-hcx-text-muted">{tc('noData')}</p>
        )}
      </div>
    </div>
  );
}
