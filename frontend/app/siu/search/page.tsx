'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMutation } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

export default function SiuSearchPage() {
  const t = useTranslations('siu.search');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';

  const [providerId, setProviderId] = useState('');
  const [patientNid, setPatientNid] = useState('');
  const [icd10, setIcd10] = useState('');
  const [procedure, setProcedure] = useState('');

  const search = useMutation({
    mutationFn: () =>
      api.siuCrossPayerSearch({
        provider_id: providerId || undefined,
        patient_nid_hash: patientNid || undefined,
        icd10_code: icd10 || undefined,
        procedure_code: procedure || undefined,
        limit: 100,
      }),
  });

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
