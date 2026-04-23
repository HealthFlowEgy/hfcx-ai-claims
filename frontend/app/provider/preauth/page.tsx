'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, Clock, ClipboardCheck, Plus, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ClaimStatusBadge } from '@/components/shared/claim-status-badge';
import { CodeSelector } from '@/components/shared/code-selector';
import { api } from '@/lib/api';
import type { ClaimStatus } from '@/lib/types';
import { formatDate, formatEgp } from '@/lib/utils';

/**
 * Fix #12: Pre-auth status tracking with visual timeline
 * Fix #13: Show approval details (auth number, valid until, authorized qty)
 */

type PreAuthRequest = {
  request_id: string;
  claim_type: string;
  patient_nid_masked: string;
  icd10: string;
  procedure: string;
  amount: number;
  status: ClaimStatus;
  requested_at: string;
  authorized_qty?: number;
  auth_number?: string;
  valid_until?: string;
  justification?: string;
};

/** Fix #12: Status timeline steps */
const STATUS_STEPS = [
  { key: 'submitted', label: 'Submitted', icon: Clock },
  { key: 'in_review', label: 'Under Review', icon: Clock },
  { key: 'approved', label: 'Approved', icon: CheckCircle2 },
] as const;

function getStepIndex(status: string): number {
  if (status === 'approved' || status === 'settled') return 2;
  if (status === 'in_review' || status === 'ai_analyzed') return 1;
  if (status === 'denied') return 3; // special
  return 0;
}

function StatusTimeline({ status }: { status: string }) {
  const currentStep = getStepIndex(status);
  const isDenied = status === 'denied';

  return (
    <div className="flex items-center gap-1 mt-2">
      {STATUS_STEPS.map((step, i) => {
        const isActive = i <= currentStep && !isDenied;
        const isCurrent = i === currentStep && !isDenied;
        return (
          <div key={step.key} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className={`h-0.5 w-6 ${
                  isActive ? 'bg-hcx-success' : 'bg-muted'
                }`}
              />
            )}
            <div
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                isCurrent
                  ? 'bg-hcx-success/20 text-hcx-success'
                  : isActive
                    ? 'bg-hcx-success/10 text-hcx-success'
                    : 'bg-muted text-hcx-text-muted'
              }`}
            >
              <step.icon className="size-3" />
              {step.label}
            </div>
          </div>
        );
      })}
      {isDenied && (
        <>
          <div className="h-0.5 w-6 bg-hcx-danger" />
          <div className="flex items-center gap-1 rounded-full bg-hcx-danger/20 px-2 py-0.5 text-[10px] font-medium text-hcx-danger">
            <XCircle className="size-3" />
            Denied
          </div>
        </>
      )}
    </div>
  );
}

export default function ProviderPreAuthPage() {
  const t = useTranslations('provider.preauth');
  const tc = useTranslations('common');
  const tClaim = useTranslations('claim');
  const locale = useLocale() as 'ar' | 'en';
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['provider', 'preauth'],
    queryFn: () => api.providerPreauth(),
  });

  const requests: PreAuthRequest[] = (data?.items ?? []).map((item) => ({
    ...item,
    status: item.status as ClaimStatus,
  }));

  const [showForm, setShowForm] = useState(false);
  const [newReq, setNewReq] = useState({
    patient_nid: '',
    icd10: '',
    procedure: '',
    amount: '',
    justification: '',
  });

  const createMutation = useMutation({
    mutationFn: (payload: {
      patient_nid: string;
      icd10: string;
      procedure: string;
      amount: number;
      justification?: string;
    }) => api.createPreauth(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider', 'preauth'] });
      setShowForm(false);
      setNewReq({
        patient_nid: '',
        icd10: '',
        procedure: '',
        amount: '',
        justification: '',
      });
    },
  });

  const submit = () => {
    createMutation.mutate({
      patient_nid: newReq.patient_nid,
      icd10: newReq.icd10,
      procedure: newReq.procedure,
      amount: Number(newReq.amount) || 0,
      justification: newReq.justification || undefined,
    });
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
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
          <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="size-4" />
          {t('createRequest')}
        </Button>
      </header>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="size-5 text-hcx-primary" aria-hidden />
              {t('createRequest')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{tClaim('patientNid')}</Label>
              <Input
                value={newReq.patient_nid}
                onChange={(e) =>
                  setNewReq({ ...newReq, patient_nid: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>ICD-10</Label>
              <CodeSelector
                value={newReq.icd10}
                onChange={(code) => setNewReq({ ...newReq, icd10: code })}
                codeType="icd10"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Procedure</Label>
              <CodeSelector
                value={newReq.procedure}
                onChange={(code) => setNewReq({ ...newReq, procedure: code })}
                codeType="cpt"
                placeholder="Search CPT code or procedure..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>{tc('amount')}</Label>
              <Input
                type="number"
                value={newReq.amount}
                onChange={(e) =>
                  setNewReq({ ...newReq, amount: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>{t('clinicalJustification')}</Label>
              <textarea
                rows={3}
                className="w-full rounded-md border border-input bg-background p-2 text-sm"
                value={newReq.justification}
                onChange={(e) =>
                  setNewReq({ ...newReq, justification: e.target.value })
                }
              />
            </div>
            <div className="md:col-span-2">
              <Button
                onClick={submit}
                disabled={createMutation.isPending}
              >
                {tc('submit')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {requests.length === 0 && (
          <p className="text-center text-sm text-hcx-text-muted py-8">
            No pre-authorization requests yet.
          </p>
        )}
        {requests.map((r) => (
          <Card key={r.request_id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">
                      {r.request_id}
                    </span>
                    <ClaimStatusBadge status={r.status} size="sm" />
                  </div>
                  <div className="mt-1 text-sm text-hcx-text-muted">
                    {r.claim_type} · {r.icd10} · {r.procedure}
                  </div>
                  {r.justification && (
                    <p className="mt-2 text-xs italic text-hcx-text-muted">
                      {r.justification}
                    </p>
                  )}
                  {/* Fix #12: Status timeline */}
                  <StatusTimeline status={r.status} />
                </div>
                <div className="text-end">
                  <div className="font-semibold tabular-nums">
                    {formatEgp(r.amount, locale)}
                  </div>
                  <div className="text-xs text-hcx-text-muted">
                    {formatDate(r.requested_at, locale)}
                  </div>
                </div>
              </div>
              {/* Fix #13: Approval details with auth number, valid until, authorized qty */}
              {r.auth_number && (
                <Alert variant="success" className="mt-3">
                  <CheckCircle2 className="size-4" />
                  <AlertTitle className="font-mono text-sm">
                    Auth: {r.auth_number}
                  </AlertTitle>
                  <AlertDescription className="text-xs">
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <div>
                        <span className="text-hcx-text-muted">{t('validUntil')}:</span>{' '}
                        <span className="font-medium">
                          {r.valid_until ? formatDate(r.valid_until, locale) : '--'}
                        </span>
                      </div>
                      <div>
                        <span className="text-hcx-text-muted">{t('authorizedQty')}:</span>{' '}
                        <span className="font-medium">{r.authorized_qty ?? '--'}</span>
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              {r.status === 'denied' && !r.auth_number && (
                <Alert variant="destructive" className="mt-3">
                  <XCircle className="size-4" />
                  <AlertTitle>Pre-authorization Denied</AlertTitle>
                  <AlertDescription className="text-xs">
                    This request was not approved. You may submit a new request with additional clinical justification.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
