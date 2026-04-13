'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ClipboardCheck, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ClaimStatusBadge } from '@/components/shared/claim-status-badge';
import { api } from '@/lib/api';
import type { ClaimStatus } from '@/lib/types';
import { formatDate, formatEgp } from '@/lib/utils';

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
              <Input
                value={newReq.icd10}
                onChange={(e) => setNewReq({ ...newReq, icd10: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Procedure</Label>
              <Input
                value={newReq.procedure}
                onChange={(e) =>
                  setNewReq({ ...newReq, procedure: e.target.value })
                }
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
        {requests.map((r) => (
          <Card key={r.request_id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
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
              {r.auth_number && (
                <Alert variant="success" className="mt-3">
                  <AlertTitle className="font-mono text-sm">
                    {r.auth_number}
                  </AlertTitle>
                  <AlertDescription className="text-xs">
                    {t('validUntil')}:{' '}
                    {r.valid_until ? formatDate(r.valid_until, locale) : '--'}
                    {' · '}
                    {t('authorizedQty')}: {r.authorized_qty ?? '--'}
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
