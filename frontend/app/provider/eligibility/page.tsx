'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PatientNidInput } from '@/components/shared/patient-nid-input';
import { api } from '@/lib/api';
import { formatDate, formatEgp } from '@/lib/utils';

type EligibilityResult = {
  status: string;
  is_eligible?: boolean | null;
  coverage_active?: boolean | null;
  coverage_type?: string | null;
  deductible_remaining?: number | null;
  copay_percentage?: number | null;
  exclusions?: string[];
  cache_hit?: boolean;
  checked_at?: string;
  error_message?: string | null;
};

export default function ProviderEligibilityPage() {
  const t = useTranslations('provider.eligibility');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const [patientNid, setPatientNid] = useState('');
  const [payerId, setPayerId] = useState('MISR-INSURANCE-001');
  const [providerId, setProviderId] = useState('HCP-EG-CAIRO-001');

  const check = useMutation({
    mutationFn: () =>
      api.verifyEligibility({
        patient_id: patientNid,
        payer_id: payerId,
        provider_id: providerId,
        service_date: new Date().toISOString(),
        claim_type: 'outpatient',
      }) as Promise<EligibilityResult>,
  });

  const result = check.data;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-hcx-primary" aria-hidden />
            {t('run')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <PatientNidInput value={patientNid} onChange={setPatientNid} />
          <div className="space-y-1.5">
            <Label htmlFor="payer">Payer</Label>
            <Input
              id="payer"
              value={payerId}
              onChange={(e) => setPayerId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="provider">Provider</Label>
            <Input
              id="provider"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
            />
          </div>
          <div className="md:col-span-3">
            <Button
              onClick={() => check.mutate()}
              disabled={patientNid.length !== 14 || check.isPending}
              aria-busy={check.isPending}
            >
              {check.isPending ? tc('loading') : t('run')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {check.isError && (
        <Alert variant="destructive">
          <XCircle className="size-4" aria-hidden />
          <AlertTitle>{tc('error')}</AlertTitle>
          <AlertDescription>{(check.error as Error).message}</AlertDescription>
        </Alert>
      )}

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.is_eligible ? (
                <CheckCircle2
                  className="size-5 text-hcx-success"
                  aria-hidden
                />
              ) : (
                <XCircle className="size-5 text-hcx-danger" aria-hidden />
              )}
              {result.is_eligible ? 'Eligible' : 'Not eligible'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
              <Info label={t('coverageActive')}>
                {result.coverage_active ? 'Yes' : 'No'}
              </Info>
              <Info label={t('coverageType')}>
                {result.coverage_type ?? '—'}
              </Info>
              <Info label={t('copayPct')}>
                {result.copay_percentage != null
                  ? `${result.copay_percentage}%`
                  : '—'}
              </Info>
              <Info label={t('deductibleRemaining')}>
                {result.deductible_remaining != null
                  ? formatEgp(result.deductible_remaining, locale)
                  : '—'}
              </Info>
              <Info label={t('exclusions')}>
                {result.exclusions && result.exclusions.length > 0
                  ? result.exclusions.join(', ')
                  : '—'}
              </Info>
              <Info label={t('lastChecked')}>
                {result.checked_at
                  ? formatDate(result.checked_at, locale)
                  : '—'}
              </Info>
              {result.cache_hit && (
                <Info label={t('cacheHit')}>Yes</Info>
              )}
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Info({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase text-hcx-text-muted">{label}</dt>
      <dd className="font-medium text-hcx-text">{children}</dd>
    </div>
  );
}
