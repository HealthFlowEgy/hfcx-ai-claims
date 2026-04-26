'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Eye, ShieldAlert, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/shared/data-table';
import { Separator } from '@/components/ui/separator';
import { api } from '@/lib/api';
import type { ClaimSummary } from '@/lib/types';
import { cn, formatDate, formatEgp, maskNationalId } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

/**
 * Fix #33: Investigation workflow with status tracking, refer to SIU,
 * mark as false positive, and investigation notes.
 */

type InvestigationStatus = 'new' | 'investigating' | 'referred' | 'false_positive' | 'confirmed_fraud';

export default function PayerFraudPage() {
  const t = useTranslations('payer.fraud');
  const tc = useTranslations('common');
  const tr = useTranslations('risk');
  const locale = useLocale() as 'ar' | 'en';

  const [selectedClaim, setSelectedClaim] = useState<ClaimSummary | null>(null);
  const [investigationNotes, setInvestigationNotes] = useState('');
  const [investigations, setInvestigations] = useState<
    Record<string, { status: InvestigationStatus; notes: string[] }>
  >({});
  const [filterStatus, setFilterStatus] = useState<'all' | 'high' | 'medium'>('all');
  // Fix #1: Provider fraud scorecard
  const [providerProfile, setProviderProfile] = useState<{
    provider_id: string;
    total_claims: number;
    flagged_claims: number;
    avg_fraud_score: number;
    total_amount_egp: number;
    flagged_amount_egp: number;
    top_diagnosis_codes: string[];
    risk_level: string;
  } | null>(null);
  useEffect(() => {
    if (!selectedClaim?.provider_id) { setProviderProfile(null); return; }
    api.providerFraudProfile(selectedClaim.provider_id)
      .then(setProviderProfile)
      .catch(() => setProviderProfile(null));
  }, [selectedClaim?.provider_id]);

  const { data } = useQuery({
    queryKey: ['payer', 'fraud'],
    queryFn: () => api.listClaims({ portal: 'siu', limit: 200 }),
  });

  const flagged = useMemo(() => {
    const items = (data?.items ?? []).filter(
      (c) => (c.ai_risk_score ?? 0) >= 0.6,
    );
    if (filterStatus === 'high') return items.filter((c) => (c.ai_risk_score ?? 0) >= 0.8);
    if (filterStatus === 'medium') return items.filter((c) => (c.ai_risk_score ?? 0) < 0.8);
    return items;
  }, [data, filterStatus]);

  const getInvestigationStatus = (claimId: string): InvestigationStatus => {
    return investigations[claimId]?.status ?? 'new';
  };

  const updateInvestigation = (claimId: string, status: InvestigationStatus) => {
    setInvestigations((prev) => ({
      ...prev,
      [claimId]: {
        status,
        notes: prev[claimId]?.notes ?? [],
      },
    }));
    toast({
      title: 'Investigation Updated',
      description: `Claim ${claimId} marked as ${status.replace('_', ' ')}.`,
      variant: 'success',
    });
  };

  const addNote = (claimId: string) => {
    if (!investigationNotes.trim()) return;
    setInvestigations((prev) => ({
      ...prev,
      [claimId]: {
        status: prev[claimId]?.status ?? 'investigating',
        notes: [...(prev[claimId]?.notes ?? []), investigationNotes],
      },
    }));
    setInvestigationNotes('');
    toast({
      title: 'Note Added',
      description: `Investigation note added to ${claimId}.`,
    });
  };

  const columns = useMemo<ColumnDef<ClaimSummary>[]>(
    () => [
      { header: 'Claim ID', accessorKey: 'claim_id' },
      { header: 'Provider', accessorKey: 'provider_id' },
      {
        header: 'Patient',
        accessorKey: 'patient_nid_masked',
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {maskNationalId(row.original.patient_nid_masked)}
          </span>
        ),
      },
      {
        header: tc('amount'),
        accessorKey: 'total_amount',
        meta: { numeric: true },
        cell: ({ row }) => formatEgp(row.original.total_amount, locale),
      },
      {
        header: tr('score'),
        accessorKey: 'ai_risk_score',
        cell: ({ row }) => {
          const score = row.original.ai_risk_score ?? 0;
          return (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-semibold',
                  score >= 0.8
                    ? 'bg-hcx-danger/15 text-hcx-danger'
                    : 'bg-hcx-warning/15 text-hcx-warning',
                )}
              >
                {Math.round(score * 100)}%
              </span>
              <div className="h-1.5 w-16 rounded-full bg-muted">
                <div
                  className={cn(
                    'h-1.5 rounded-full',
                    score >= 0.8 ? 'bg-hcx-danger' : 'bg-hcx-warning',
                  )}
                  style={{ width: `${score * 100}%` }}
                />
              </div>
            </div>
          );
        },
      },
      {
        header: 'Investigation',
        id: 'investigation_status',
        cell: ({ row }) => {
          const status = getInvestigationStatus(row.original.claim_id);
          const colors: Record<InvestigationStatus, string> = {
            new: 'bg-muted text-hcx-text-muted',
            investigating: 'bg-hcx-primary/10 text-hcx-primary',
            referred: 'bg-hcx-warning/10 text-hcx-warning',
            false_positive: 'bg-hcx-success/10 text-hcx-success',
            confirmed_fraud: 'bg-hcx-danger/10 text-hcx-danger',
          };
          return (
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', colors[status])}>
              {status.replace('_', ' ')}
            </span>
          );
        },
      },
      {
        header: tc('date'),
        accessorKey: 'submitted_at',
        cell: ({ row }) => formatDate(row.original.submitted_at, locale),
      },
      {
        header: tc('actions'),
        id: 'actions',
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelectedClaim(row.original)}
          >
            <Eye className="size-3" />
            Investigate
          </Button>
        ),
      },
    ],
    [locale, t, tc, tr, investigations],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-hcx-text">
          <ShieldAlert className="size-6 text-hcx-danger" aria-hidden />
          {t('title')}
        </h1>
        <p className="text-sm text-hcx-text-muted">{t('intro')}</p>
      </header>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-hcx-danger/30 p-3 text-center">
          <p className="text-xs text-hcx-text-muted">High Risk (80%+)</p>
          <p className="text-xl font-bold text-hcx-danger">
            {(data?.items ?? []).filter((c) => (c.ai_risk_score ?? 0) >= 0.8).length}
          </p>
        </div>
        <div className="rounded-lg border border-hcx-warning/30 p-3 text-center">
          <p className="text-xs text-hcx-text-muted">Medium Risk (60-80%)</p>
          <p className="text-xl font-bold text-hcx-warning">
            {(data?.items ?? []).filter((c) => {
              const s = c.ai_risk_score ?? 0;
              return s >= 0.6 && s < 0.8;
            }).length}
          </p>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-xs text-hcx-text-muted">Under Investigation</p>
          <p className="text-xl font-bold">
            {Object.values(investigations).filter((i) => i.status === 'investigating').length}
          </p>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-xs text-hcx-text-muted">Referred to SIU</p>
          <p className="text-xl font-bold">
            {Object.values(investigations).filter((i) => i.status === 'referred').length}
          </p>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2">
        {(['all', 'high', 'medium'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilterStatus(f)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              filterStatus === f
                ? 'bg-hcx-primary text-white'
                : 'bg-muted text-hcx-text-muted hover:bg-accent',
            )}
          >
            {f === 'all' ? `All (${flagged.length})` : f === 'high' ? 'High Risk' : 'Medium Risk'}
          </button>
        ))}
      </div>

      <div className={cn('grid gap-4', selectedClaim ? 'grid-cols-1 lg:grid-cols-[2fr_1fr]' : 'grid-cols-1')}>
        <Card>
          <CardHeader>
            <CardTitle>
              {flagged.length} flagged claims
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable columns={columns} data={flagged} />
          </CardContent>
        </Card>

        {/* Investigation panel */}
        {selectedClaim && (
          <Card className="h-fit">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">
                <AlertTriangle className="inline size-4 text-hcx-danger" />{' '}
                {selectedClaim.claim_id}
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setSelectedClaim(null)}>
                <X className="size-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-xs text-hcx-text-muted">Risk Score</span>
                  <p className="font-bold text-hcx-danger">
                    {Math.round((selectedClaim.ai_risk_score ?? 0) * 100)}%
                  </p>
                </div>
                <div>
                  <span className="text-xs text-hcx-text-muted">Amount</span>
                  <p className="font-semibold">{formatEgp(selectedClaim.total_amount, locale)}</p>
                </div>
                <div>
                  <span className="text-xs text-hcx-text-muted">Provider</span>
                  <p>{selectedClaim.provider_id}</p>
                </div>
                <div>
                  <span className="text-xs text-hcx-text-muted">Patient</span>
                  <p className="font-mono text-xs">{selectedClaim.patient_nid_masked}</p>
                </div>
              </div>

              <Separator />

              {/* Fix #1: Provider Fraud Scorecard */}
              {providerProfile && providerProfile.total_claims > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-semibold">Provider Fraud Profile</p>
                  <div className="rounded-md border border-hcx-danger/20 bg-hcx-danger/5 p-2 space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-hcx-text-muted">Risk Level</span>
                      <span className={cn(
                        'font-semibold',
                        providerProfile.risk_level === 'high' ? 'text-hcx-danger' :
                        providerProfile.risk_level === 'medium' ? 'text-hcx-warning' : 'text-hcx-success'
                      )}>{providerProfile.risk_level}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-hcx-text-muted">Total Claims</span>
                      <span className="font-medium">{providerProfile.total_claims}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-hcx-text-muted">Flagged Claims</span>
                      <span className="font-medium text-hcx-danger">{providerProfile.flagged_claims}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-hcx-text-muted">Avg Fraud Score</span>
                      <span className="font-medium">{(providerProfile.avg_fraud_score * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-hcx-text-muted">Flagged Amount</span>
                      <span className="font-medium">{formatEgp(providerProfile.flagged_amount_egp, locale)}</span>
                    </div>
                    {providerProfile.top_diagnosis_codes.length > 0 && (
                      <div>
                        <span className="text-hcx-text-muted">Top Diagnoses: </span>
                        <span className="font-mono">{providerProfile.top_diagnosis_codes.join(', ')}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <Separator />

              {/* Investigation actions */}
              <div className="space-y-2">
                <p className="text-sm font-semibold">Actions</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => updateInvestigation(selectedClaim.claim_id, 'investigating')}
                  >
                    Start Investigation
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updateInvestigation(selectedClaim.claim_id, 'referred')}
                  >
                    Refer to SIU
                  </Button>
                  <Button
                    size="sm"
                    variant="success"
                    onClick={() => updateInvestigation(selectedClaim.claim_id, 'false_positive')}
                  >
                    False Positive
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => updateInvestigation(selectedClaim.claim_id, 'confirmed_fraud')}
                  >
                    Confirm Fraud
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Investigation notes */}
              <div className="space-y-2">
                <p className="text-sm font-semibold">Notes</p>
                {(investigations[selectedClaim.claim_id]?.notes ?? []).map((note, i) => (
                  <div key={i} className="rounded border border-border p-2 text-xs">
                    {note}
                  </div>
                ))}
                <textarea
                  rows={2}
                  placeholder="Add investigation note..."
                  value={investigationNotes}
                  onChange={(e) => setInvestigationNotes(e.target.value)}
                  className="w-full rounded-md border border-input bg-background p-2 text-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => addNote(selectedClaim.claim_id)}
                  disabled={!investigationNotes.trim()}
                >
                  Add Note
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
