'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMutation } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Search, ShieldAlert, User, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { DataTable } from '@/components/shared/data-table';
import { api } from '@/lib/api';
import { cn, formatDate, formatEgp } from '@/lib/utils';

type SearchResult = {
  claim_id: string;
  correlation_id: string;
  payer_id: string;
  provider_id: string;
  total_amount: number;
  claim_type: string;
  submitted_at: string;
  is_potential_duplicate: boolean;
};

type ProviderProfile = {
  provider_id: string;
  total_claims: number;
  flagged_claims: number;
  avg_fraud_score: number;
  total_amount_egp: number;
  flagged_amount_egp: number;
  top_diagnosis_codes: string[];
  risk_level: string;
};

type BeneficiaryProfile = {
  patient_nid_hash: string;
  total_claims: number;
  flagged_claims: number;
  avg_fraud_score: number;
  total_amount_egp: number;
  distinct_providers: number;
  risk_level: string;
};

export default function SiuSearchPage() {
  const t = useTranslations('siu.search');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';

  const [providerId, setProviderId] = useState('');
  const [patientNid, setPatientNid] = useState('');
  const [icd10, setIcd10] = useState('');
  const [procedure, setProcedure] = useState('');

  // Fix #1: Fraud profile panels
  const [providerProfile, setProviderProfile] = useState<ProviderProfile | null>(null);
  const [beneficiaryProfile, setBeneficiaryProfile] = useState<BeneficiaryProfile | null>(null);
  const [nidHash, setNidHash] = useState<string | null>(null);

  // ISSUE-021: Hash NID client-side using SHA-256 before sending
  const search = useMutation({
    mutationFn: async () => {
      let hash: string | undefined;
      if (patientNid) {
        const encoded = new TextEncoder().encode(patientNid);
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
        hash = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        setNidHash(hash);
      } else {
        setNidHash(null);
      }
      return api.siuCrossPayerSearch({
        provider_id: providerId || undefined,
        patient_nid_hash: hash,
        icd10_code: icd10 || undefined,
        procedure_code: procedure || undefined,
        limit: 100,
      });
    },
  });

  // Fix #1: Auto-fetch provider fraud profile when search completes with a provider_id
  useEffect(() => {
    if (!providerId || !search.data) { setProviderProfile(null); return; }
    api.providerFraudProfile(providerId)
      .then(setProviderProfile)
      .catch(() => setProviderProfile(null));
  }, [providerId, search.data]);

  // Fix #1: Auto-fetch beneficiary risk profile when search completes with a NID hash
  useEffect(() => {
    if (!nidHash || !search.data) { setBeneficiaryProfile(null); return; }
    api.beneficiaryRiskProfile(nidHash)
      .then(setBeneficiaryProfile)
      .catch(() => setBeneficiaryProfile(null));
  }, [nidHash, search.data]);

  const results = search.data ?? [];

  const columns = useMemo<ColumnDef<SearchResult>[]>(
    () => [
      { header: 'Claim ID', accessorKey: 'claim_id' },
      { header: 'Payer', accessorKey: 'payer_id' },
      { header: 'Provider', accessorKey: 'provider_id' },
      { header: tc('type'), accessorKey: 'claim_type' },
      {
        header: tc('amount'),
        accessorKey: 'total_amount',
        meta: { numeric: true },
        cell: ({ row }) => formatEgp(row.original.total_amount, locale),
      },
      {
        header: tc('date'),
        accessorKey: 'submitted_at',
        cell: ({ row }) => formatDate(row.original.submitted_at, locale),
      },
      {
        header: '',
        id: 'dup',
        cell: ({ row }) =>
          row.original.is_potential_duplicate ? (
            <Badge variant="destructive">{t('potentialDuplicate')}</Badge>
          ) : null,
      },
    ],
    [locale, t, tc],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="size-5 text-hcx-primary" aria-hidden />
            {t('searchBy')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="provider-id">{t('providerId')}</Label>
            <Input
              id="provider-id"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="patient-nid">{t('patientNid')}</Label>
            <Input
              id="patient-nid"
              dir="ltr"
              value={patientNid}
              onChange={(e) => setPatientNid(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="icd10">{t('icd10')}</Label>
            <Input
              id="icd10"
              value={icd10}
              onChange={(e) => setIcd10(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proc">{t('procedureCode')}</Label>
            <Input
              id="proc"
              value={procedure}
              onChange={(e) => setProcedure(e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <Button
              onClick={() => search.mutate()}
              disabled={search.isPending}
              aria-busy={search.isPending}
            >
              {search.isPending ? tc('loading') : t('runSearch')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Fix #1: Provider Fraud Scorecard + Beneficiary Risk Scorecard */}
      {(providerProfile || beneficiaryProfile) && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {providerProfile && providerProfile.total_claims > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldAlert className="size-4 text-hcx-danger" aria-hidden />
                  Provider Fraud Profile
                  <Button
                    variant="ghost" size="icon" className="ml-auto size-6"
                    onClick={() => setProviderProfile(null)}
                  >
                    <X className="size-3" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-hcx-text-muted">Provider</span>
                  <span className="font-mono font-medium">{providerProfile.provider_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-hcx-text-muted">Risk Level</span>
                  <span className={cn(
                    'font-semibold',
                    providerProfile.risk_level === 'high' ? 'text-hcx-danger' :
                    providerProfile.risk_level === 'medium' ? 'text-hcx-warning' : 'text-hcx-success'
                  )}>{providerProfile.risk_level}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-hcx-text-muted">Total Claims</span>
                  <span>{providerProfile.total_claims}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-hcx-text-muted">Flagged Claims</span>
                  <span className="text-hcx-danger">{providerProfile.flagged_claims}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-hcx-text-muted">Avg Fraud Score</span>
                  <span>{(providerProfile.avg_fraud_score * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-hcx-text-muted">Total Amount</span>
                  <span>{formatEgp(providerProfile.total_amount_egp, locale)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-hcx-text-muted">Flagged Amount</span>
                  <span className="text-hcx-danger">{formatEgp(providerProfile.flagged_amount_egp, locale)}</span>
                </div>
                {providerProfile.top_diagnosis_codes.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <span className="text-hcx-text-muted text-xs">Top Diagnoses</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {providerProfile.top_diagnosis_codes.map((c) => (
                          <Badge key={c} variant="outline" className="font-mono text-xs">{c}</Badge>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {beneficiaryProfile && beneficiaryProfile.total_claims > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <User className="size-4 text-hcx-warning" aria-hidden />
                  Beneficiary Risk Profile
                  <Button
                    variant="ghost" size="icon" className="ml-auto size-6"
                    onClick={() => setBeneficiaryProfile(null)}
                  >
                    <X className="size-3" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-hcx-text-muted">Risk Level</span>
                  <span className={cn(
                    'font-semibold',
                    beneficiaryProfile.risk_level === 'high' ? 'text-hcx-danger' :
                    beneficiaryProfile.risk_level === 'medium' ? 'text-hcx-warning' : 'text-hcx-success'
                  )}>{beneficiaryProfile.risk_level}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-hcx-text-muted">Total Claims</span>
                  <span>{beneficiaryProfile.total_claims}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-hcx-text-muted">Flagged Claims</span>
                  <span className="text-hcx-danger">{beneficiaryProfile.flagged_claims}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-hcx-text-muted">Avg Fraud Score</span>
                  <span>{(beneficiaryProfile.avg_fraud_score * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-hcx-text-muted">Total Amount</span>
                  <span>{formatEgp(beneficiaryProfile.total_amount_egp, locale)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-hcx-text-muted">Distinct Providers</span>
                  <span>{beneficiaryProfile.distinct_providers}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t('results')} — {results.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={results}
              className={cn(
                results.some((r) => r.is_potential_duplicate) &&
                  '[&_tbody_tr:has(.badge-dup)]:bg-hcx-danger/5',
              )}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
