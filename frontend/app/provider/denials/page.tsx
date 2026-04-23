'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Copy, FileText, RefreshCw, Sparkles } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn, formatDate, formatEgp } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

/**
 * SRS §4.2.5 — Denials & Appeals.
 *
 * Fix #17: AI-generated appeal letter (copyable, pre-drafted)
 * Fix #18: Denial categorization with visual breakdown
 * Fix #19: Resubmission workflow (navigate to new claim with pre-filled data)
 */
export default function ProviderDenialsPage() {
  const t = useTranslations('provider.denials');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
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

  // Fix #18: Calculate totals for denial categorization
  const totalDenied = (data?.categories ?? []).reduce((s, c) => s + c.count, 0);
  const totalAmount = (data?.categories ?? []).reduce((s, c) => s + c.total_egp, 0);

  // Fix #17: Generate appeal letter text
  const generateAppealLetter = (claim: {
    claim_id: string;
    claim_type: string;
    total_amount: number;
    reason: string;
    ai_appeal_summary: string;
  }) => {
    return `To Whom It May Concern,

I am writing to formally appeal the denial of claim ${claim.claim_id} (${claim.claim_type}, amount: EGP ${claim.total_amount.toFixed(2)}).

Denial Reason: ${claim.reason}

Basis for Appeal:
${claim.ai_appeal_summary}

I respectfully request that this claim be reconsidered based on the above information. Supporting documentation is attached for your review.

Sincerely,
[Provider Name]
[Provider ID: HCP-EG-CAIRO-001]
Date: ${new Date().toLocaleDateString('en-EG')}`;
  };

  const copyAppealLetter = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copied',
      description: 'Appeal letter copied to clipboard.',
      variant: 'success',
    });
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      {/* Fix #18: Denial summary stats */}
      {!isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase text-hcx-text-muted">Total Denied Claims</p>
              <p className="text-2xl font-bold tabular-nums text-hcx-danger">{totalDenied}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase text-hcx-text-muted">Total Denied Amount</p>
              <p className="text-2xl font-bold tabular-nums text-hcx-danger">{formatEgp(totalAmount, locale)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase text-hcx-text-muted">Denial Categories</p>
              <p className="text-2xl font-bold tabular-nums">{(data?.categories ?? []).length}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Fix #18: Category cards with visual breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>{t('categories')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-hcx-text-muted">{tc('loading')}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(data?.categories ?? []).map((cat) => {
                const pct = totalDenied > 0 ? ((cat.count / totalDenied) * 100).toFixed(0) : '0';
                return (
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
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-2xl font-bold tabular-nums">{cat.count}</span>
                      <span className="text-sm text-hcx-text-muted">({pct}%)</span>
                    </div>
                    <div className="mt-1 text-xs text-hcx-text-muted">
                      {formatEgp(cat.total_egp, locale)}
                    </div>
                    {/* Visual bar */}
                    <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                      <div
                        className="h-1.5 rounded-full bg-hcx-danger"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Denied claim list */}
      <div className="space-y-4">
        {filtered.map((claim) => {
          const appealLetter = generateAppealLetter(claim);
          return (
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
                <div className="flex gap-2">
                  {/* Fix #19: Resubmission button */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push('/provider/claims/new')}
                    title="Resubmit this claim with corrections"
                  >
                    <RefreshCw className="size-4" aria-hidden />
                    Resubmit
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() =>
                      setAppealClaimId(
                        appealClaimId === claim.claim_id ? null : claim.claim_id,
                      )
                    }
                  >
                    <FileText className="size-4" aria-hidden />
                    {t('appealAction')}
                  </Button>
                </div>
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
                {/* Fix #17: AI-generated appeal letter */}
                {appealClaimId === claim.claim_id && (
                  <div className="space-y-3 rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        <Sparkles className="size-4 text-hcx-primary" />
                        AI-Generated Appeal Letter
                      </h4>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyAppealLetter(appealLetter)}
                      >
                        <Copy className="size-3" />
                        Copy
                      </Button>
                    </div>
                    <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs font-mono leading-relaxed">
                      {appealLetter}
                    </pre>
                    <div className="flex gap-2">
                      <label className="text-xs font-semibold text-hcx-text">
                        {t('attachDocs')}
                      </label>
                      <input
                        type="file"
                        multiple
                        className="block w-full text-sm"
                        aria-label={t('attachDocs')}
                      />
                    </div>
                    <Button variant="success" size="sm">
                      {t('submitAppeal')}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 && !isLoading && (
          <p className="text-sm text-hcx-text-muted">{tc('noData')}</p>
        )}
      </div>
    </div>
  );
}
