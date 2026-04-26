'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  ShieldAlert,
  Stethoscope,
  XCircle,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { api } from '@/lib/api';
import { cn, formatDate, formatEgp } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

type PreAuthItem = {
  request_id: string;
  provider_id: string;
  patient_nid_masked: string;
  icd10: string;
  procedure: string;
  amount: number;
  status: string;
  requested_at: string;
  justification?: string;
  verdict?: string;
  confidence?: number;
  guidelines?: string[];
  claim_id?: string;
};

type DecisionType = 'approved' | 'partial' | 'more_info' | 'denied';

export default function PayerPreAuthPage() {
  const t = useTranslations('payer.preauth');
  const tq = useTranslations('payer.queue');
  const locale = useLocale() as 'ar' | 'en';
  const queryClient = useQueryClient();

  const { data: apiData, isLoading } = useQuery({
    queryKey: ['payer', 'preauth'],
    queryFn: () => api.payerPreauth(),
    refetchInterval: 30_000,
  });

  const reviews: PreAuthItem[] = useMemo(() => {
    const items = apiData?.items;
    if (items && items.length > 0) return items as PreAuthItem[];
    return [];
  }, [apiData]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = reviews.find((r) => r.request_id === selectedId) ?? reviews[0] ?? null;

  // Decision confirmation state
  const [confirmDecision, setConfirmDecision] = useState<{
    requestId: string;
    decision: DecisionType;
  } | null>(null);
  const [decisionReason, setDecisionReason] = useState('');

  // Use typed API function instead of raw fetch
  const decisionMutation = useMutation({
    mutationFn: async ({
      requestId,
      decision,
      reason,
    }: {
      requestId: string;
      decision: DecisionType;
      reason?: string;
    }) => {
      return api.updatePreauthStatus({
        request_id: requestId,
        decision,
        reason,
      });
    },
    onSuccess: (_data, variables) => {
      toast({
        variant: 'success',
        title: locale === 'ar' ? 'تم إرسال القرار' : 'Decision submitted',
        description:
          locale === 'ar'
            ? `تم تحديث طلب ${variables.requestId} إلى ${variables.decision}`
            : `Pre-auth ${variables.requestId} marked as ${variables.decision}`,
      });
      // Optimistic update
      queryClient.setQueryData(
        ['payer', 'preauth'],
        (old: { items?: PreAuthItem[] } | undefined) => {
          if (!old?.items) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.request_id === variables.requestId
                ? { ...item, status: variables.decision }
                : item,
            ),
          };
        },
      );
      queryClient.invalidateQueries({ queryKey: ['payer', 'preauth'] });
      setConfirmDecision(null);
      setDecisionReason('');
    },
    onError: () => {
      toast({
        variant: 'destructive',
        title: locale === 'ar' ? 'خطأ' : 'Error',
        description:
          locale === 'ar'
            ? 'فشل في إرسال القرار. يرجى المحاولة مرة أخرى.'
            : 'Failed to submit decision. Please try again.',
      });
    },
  });

  const handleDecision = (decision: DecisionType) => {
    const rid = selected?.request_id;
    if (!rid) return;
    if (decision === 'denied' || decision === 'partial') {
      setConfirmDecision({ requestId: rid, decision });
    } else {
      decisionMutation.mutate({ requestId: rid, decision });
    }
  };

  const confirmAndSubmit = () => {
    if (!confirmDecision) return;
    decisionMutation.mutate({
      ...confirmDecision,
      reason: decisionReason || undefined,
    });
  };

  const isPending = decisionMutation.isPending;

  if (isLoading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-hcx-primary" />
      </div>
    );
  }

  const verdictColor = (v?: string) =>
    v === 'necessary'
      ? 'text-hcx-success'
      : v === 'not_justified'
        ? 'text-hcx-danger'
        : 'text-hcx-warning';

  const verdictBg = (v?: string) =>
    v === 'necessary'
      ? 'bg-hcx-success/10 border-hcx-success/30'
      : v === 'not_justified'
        ? 'bg-hcx-danger/10 border-hcx-danger/30'
        : 'bg-hcx-warning/10 border-hcx-warning/30';

  const statusLabel = (s: string) => {
    if (s === 'approved') return locale === 'ar' ? 'موافق عليه' : 'Approved';
    if (s === 'denied') return locale === 'ar' ? 'مرفوض' : 'Denied';
    if (s === 'partial') return locale === 'ar' ? 'موافقة جزئية' : 'Partial';
    return locale === 'ar' ? 'قيد المراجعة' : 'Pending Review';
  };

  const statusBadgeVariant = (s: string): 'success' | 'destructive' | 'warning' | 'default' => {
    if (s === 'approved') return 'success';
    if (s === 'denied') return 'destructive';
    if (s === 'partial') return 'warning';
    return 'default';
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      {reviews.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="size-12 text-hcx-text-muted/40" />
            <p className="mt-3 text-sm text-hcx-text-muted">
              {locale === 'ar' ? 'لا توجد طلبات موافقة مسبقة حالياً' : 'No pre-authorization requests at this time'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[380px_1fr]">
          {/* Left: Request list */}
          <Card className="max-h-[calc(100vh-180px)] overflow-hidden">
            <CardHeader className="border-b pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <Stethoscope className="size-4 text-hcx-primary" />
                  {locale === 'ar' ? 'طلبات الموافقة المسبقة' : 'Pre-Auth Requests'}
                </span>
                <Badge variant="outline" className="text-xs">
                  {reviews.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 overflow-y-auto p-2" style={{ maxHeight: 'calc(100vh - 260px)' }}>
              {reviews.map((r) => {
                const isSelected = (selectedId ?? reviews[0]?.request_id) === r.request_id;
                const isDecided = r.status === 'approved' || r.status === 'denied' || r.status === 'partial';
                return (
                  <button
                    key={r.request_id}
                    type="button"
                    onClick={() => {
                      setSelectedId(r.request_id);
                      setConfirmDecision(null);
                    }}
                    className={cn(
                      'w-full rounded-lg border p-3 text-start transition-all',
                      isSelected
                        ? 'border-hcx-primary bg-hcx-primary/5 shadow-sm'
                        : 'border-border hover:bg-accent/50',
                      isDecided && 'opacity-70',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-medium">{r.request_id}</span>
                      <Badge variant={statusBadgeVariant(r.status)} className="text-[10px]">
                        {statusLabel(r.status)}
                      </Badge>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-sm">
                      <span className="font-medium">{r.icd10}</span>
                      <span className="text-hcx-text-muted">·</span>
                      <span className="truncate text-hcx-text-muted">{r.procedure}</span>
                    </div>
                    <div className="mt-1 text-xs text-hcx-text-muted">{r.provider_id}</div>
                    <div className="mt-1.5 flex items-center justify-between text-xs text-hcx-text-muted">
                      <span className="font-semibold text-hcx-text">{formatEgp(r.amount, locale)}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        {formatDate(r.requested_at, locale)}
                      </span>
                    </div>
                    {/* Confidence bar */}
                    {(r.confidence ?? 0) > 0 && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-muted">
                          <div
                            className={cn(
                              'h-1.5 rounded-full transition-all',
                              (r.confidence ?? 0) > 0.8
                                ? 'bg-hcx-success'
                                : (r.confidence ?? 0) > 0.5
                                  ? 'bg-hcx-warning'
                                  : 'bg-hcx-danger',
                            )}
                            style={{ width: `${(r.confidence ?? 0) * 100}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-medium">
                          {Math.round((r.confidence ?? 0) * 100)}%
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* Right: Detail panel */}
          {selected && (
            <div className="space-y-4">
              {/* Header card */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Stethoscope className="size-5 text-hcx-primary" />
                      {selected.request_id}
                    </CardTitle>
                    <Badge variant={statusBadgeVariant(selected.status)} className="text-sm">
                      {statusLabel(selected.status)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* AI Verdict */}
                  <div className={cn('rounded-lg border p-4', verdictBg(selected.verdict))}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {selected.verdict === 'necessary' ? (
                          <CheckCircle2 className="size-5 text-hcx-success" />
                        ) : selected.verdict === 'not_justified' ? (
                          <XCircle className="size-5 text-hcx-danger" />
                        ) : (
                          <AlertTriangle className="size-5 text-hcx-warning" />
                        )}
                        <span className={cn('text-base font-semibold', verdictColor(selected.verdict))}>
                          {selected.verdict === 'necessary'
                            ? locale === 'ar' ? 'ضروري طبياً' : 'Medically Necessary'
                            : selected.verdict === 'not_justified'
                              ? locale === 'ar' ? 'غير مبرر' : 'Not Justified'
                              : locale === 'ar' ? 'يحتاج مراجعة' : 'Needs Review'}
                        </span>
                      </div>
                      <div className="text-end">
                        <div className="text-2xl font-bold">
                          {Math.round((selected.confidence ?? 0) * 100)}%
                        </div>
                        <div className="text-xs text-hcx-text-muted">
                          {locale === 'ar' ? 'ثقة الذكاء الاصطناعي' : 'AI Confidence'}
                        </div>
                      </div>
                    </div>
                    {/* Confidence bar */}
                    <div className="mt-3 h-2 w-full rounded-full bg-white/50">
                      <div
                        className={cn(
                          'h-2 rounded-full transition-all',
                          (selected.confidence ?? 0) > 0.8
                            ? 'bg-hcx-success'
                            : (selected.confidence ?? 0) > 0.5
                              ? 'bg-hcx-warning'
                              : 'bg-hcx-danger',
                        )}
                        style={{ width: `${(selected.confidence ?? 0) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Patient & Claim details */}
                  <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                    <div className="rounded-md bg-muted/50 p-2.5">
                      <span className="text-xs text-hcx-text-muted">
                        {locale === 'ar' ? 'الرقم القومي' : 'Patient NID'}
                      </span>
                      <p className="mt-0.5 font-mono text-sm">{selected.patient_nid_masked}</p>
                    </div>
                    <div className="rounded-md bg-muted/50 p-2.5">
                      <span className="text-xs text-hcx-text-muted">
                        {locale === 'ar' ? 'المبلغ' : 'Amount'}
                      </span>
                      <p className="mt-0.5 text-sm font-semibold">{formatEgp(selected.amount, locale)}</p>
                    </div>
                    <div className="rounded-md bg-muted/50 p-2.5">
                      <span className="text-xs text-hcx-text-muted">ICD-10</span>
                      <p className="mt-0.5 text-sm font-medium">{selected.icd10}</p>
                    </div>
                    <div className="rounded-md bg-muted/50 p-2.5">
                      <span className="text-xs text-hcx-text-muted">
                        {locale === 'ar' ? 'الإجراء' : 'Procedure'}
                      </span>
                      <p className="mt-0.5 text-sm">{selected.procedure}</p>
                    </div>
                  </div>

                  {/* Justification */}
                  {selected.justification && (
                    <div className="rounded-md border bg-muted/30 p-3">
                      <h3 className="mb-1 text-xs font-semibold text-hcx-text-muted">
                        {locale === 'ar' ? 'المبرر السريري' : 'Clinical Justification'}
                      </h3>
                      <p className="text-sm">{selected.justification}</p>
                    </div>
                  )}

                  {/* Clinical Guidelines */}
                  {selected.guidelines && selected.guidelines.length > 0 && (
                    <div className="rounded-md border p-3">
                      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                        <ShieldAlert className="size-4 text-hcx-primary" />
                        {locale === 'ar' ? 'الإرشادات السريرية' : 'Clinical Guidelines'}
                      </h3>
                      <ul className="list-disc space-y-1 ps-5 text-sm text-hcx-text-muted">
                        {selected.guidelines.map((g) => (
                          <li key={g}>{g}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Decision Card */}
              <Card className="border-2 border-hcx-primary/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {locale === 'ar' ? 'قرار المراجعة' : 'Review Decision'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Confirmation dialog */}
                  {confirmDecision && (
                    <Alert variant="warning">
                      <AlertTriangle className="size-4" />
                      <AlertTitle>
                        {confirmDecision.decision === 'denied'
                          ? locale === 'ar' ? 'تأكيد الرفض' : 'Confirm Denial'
                          : locale === 'ar' ? 'تأكيد الموافقة الجزئية' : 'Confirm Partial Approval'}
                      </AlertTitle>
                      <AlertDescription className="space-y-3">
                        <textarea
                          rows={2}
                          placeholder={
                            locale === 'ar'
                              ? 'السبب (اختياري للموافقة الجزئية، مطلوب للرفض)...'
                              : 'Reason (optional for partial, recommended for denial)...'
                          }
                          value={decisionReason}
                          onChange={(e) => setDecisionReason(e.target.value)}
                          className="mt-2 w-full rounded-md border border-input bg-background p-2 text-sm"
                        />
                        <div className="flex gap-2">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={confirmAndSubmit}
                            disabled={isPending}
                          >
                            {isPending ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              locale === 'ar' ? 'تأكيد' : 'Confirm'
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setConfirmDecision(null);
                              setDecisionReason('');
                            }}
                          >
                            {locale === 'ar' ? 'إلغاء' : 'Cancel'}
                          </Button>
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Decision buttons */}
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Button
                      variant="success"
                      className="h-12"
                      onClick={() => handleDecision('approved')}
                      disabled={isPending || selected.status === 'approved'}
                    >
                      {isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-4" />
                      )}
                      <span className="ms-1.5">{tq('approve')}</span>
                    </Button>
                    <Button
                      variant="default"
                      className="h-12"
                      onClick={() => handleDecision('partial')}
                      disabled={isPending || selected.status === 'partial'}
                    >
                      {t('partialApprove')}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-12"
                      onClick={() => handleDecision('more_info')}
                      disabled={isPending}
                    >
                      {t('requestMoreInfo')}
                    </Button>
                    <Button
                      variant="destructive"
                      className="h-12"
                      onClick={() => handleDecision('denied')}
                      disabled={isPending || selected.status === 'denied'}
                    >
                      {isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <XCircle className="size-4" />
                      )}
                      <span className="ms-1.5">{tq('deny')}</span>
                    </Button>
                  </div>

                  {/* Show current status if already decided */}
                  {(selected.status === 'approved' || selected.status === 'denied' || selected.status === 'partial') && (
                    <Alert variant={selected.status === 'approved' ? 'success' : selected.status === 'denied' ? 'destructive' : 'warning'}>
                      <CheckCircle2 className="size-4" />
                      <AlertTitle>
                        {locale === 'ar' ? 'تم اتخاذ القرار' : 'Decision Made'}
                      </AlertTitle>
                      <AlertDescription>
                        {locale === 'ar'
                          ? `هذا الطلب ${selected.status === 'approved' ? 'تمت الموافقة عليه' : selected.status === 'denied' ? 'تم رفضه' : 'تمت الموافقة الجزئية عليه'}`
                          : `This request has been ${selected.status}`}
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
