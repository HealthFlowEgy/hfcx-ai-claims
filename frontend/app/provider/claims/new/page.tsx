'use client';

import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { useLocale, useTranslations } from 'next-intl';
import { Plus, Send, Trash2 } from 'lucide-react';
import { z } from 'zod';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PatientNidInput } from '@/components/shared/patient-nid-input';
import { api } from '@/lib/api';
import { formatEgp } from '@/lib/utils';

/**
 * SRS §4.2.2 — New Claim Submission form.
 *
 * Flow: NID → eligibility → claim type → service lines → submit.
 * This initial implementation covers the critical path: the form
 * structure, zod validation, service-line field array, real-time
 * total, and the POST to /internal/ai/coordinate on submit.
 *
 * The full FR-PP-ICD-001 Arabic autocomplete is wired as a plain
 * text input today — the searchable combobox lives in the next
 * iteration once the ICD-10 search endpoint is online.
 */

const serviceLineSchema = z.object({
  service_date: z.string().min(1),
  icd10_code: z.string().regex(/^[A-Z]\d{2}(\.\d{1,4})?$/i, 'Invalid ICD-10'),
  procedure_code: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
  amount: z.coerce.number().nonnegative(),
});

const claimSchema = z.object({
  patient_nid: z.string().regex(/^\d{14}$/),
  claim_type: z.enum(['outpatient', 'inpatient', 'pharmacy', 'lab', 'dental', 'vision']),
  payer_id: z.string().min(1),
  provider_id: z.string().min(1),
  service_lines: z.array(serviceLineSchema).min(1),
  clinical_notes: z.string().optional(),
});

type ClaimFormValues = z.infer<typeof claimSchema>;

export default function NewClaimPage() {
  const t = useTranslations('provider.newClaim');
  const tc = useTranslations('common');
  const tClaim = useTranslations('claim');
  const locale = useLocale();

  const [successInfo, setSuccessInfo] = useState<{
    claim_id: string;
    correlation_id: string;
  } | null>(null);

  const form = useForm<ClaimFormValues>({
    resolver: zodResolver(claimSchema),
    defaultValues: {
      patient_nid: '',
      claim_type: 'outpatient',
      payer_id: 'MISR-INSURANCE-001',
      provider_id: 'HCP-EG-CAIRO-001',
      service_lines: [
        {
          service_date: new Date().toISOString().slice(0, 10),
          icd10_code: '',
          procedure_code: '',
          quantity: 1,
          amount: 0,
        },
      ],
      clinical_notes: '',
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'service_lines',
  });

  const watchedLines = form.watch('service_lines');
  const totalAmount = useMemo(
    () =>
      (watchedLines ?? []).reduce(
        (sum, line) =>
          sum +
          Number(line?.amount || 0) * Number(line?.quantity || 1),
        0,
      ),
    [watchedLines],
  );

  const submit = useMutation({
    mutationFn: async (values: ClaimFormValues) => {
      // Translate form values into the FHIR Claim bundle the backend expects.
      const claim_id = `CLAIM-${Date.now()}`;
      const bundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'Claim',
              id: claim_id,
              type: { coding: [{ code: claimTypeToFhir(values.claim_type) }] },
              patient: { reference: `Patient/${values.patient_nid}` },
              provider: { reference: `Organization/${values.provider_id}` },
              insurance: [
                { coverage: { reference: `Coverage/${values.payer_id}` } },
              ],
              created: new Date().toISOString(),
              diagnosis: values.service_lines.map((line, i) => ({
                sequence: i + 1,
                diagnosisCodeableConcept: {
                  coding: [
                    {
                      code: line.icd10_code.toUpperCase(),
                      system: 'http://hl7.org/fhir/sid/icd-10',
                    },
                  ],
                },
              })),
              total: { value: totalAmount, currency: 'EGP' },
              item: values.service_lines.map((line, i) => ({
                sequence: i + 1,
                servicedDate: line.service_date,
                productOrService: { coding: [{ code: line.procedure_code }] },
                quantity: { value: line.quantity },
                unitPrice: { value: line.amount, currency: 'EGP' },
              })),
              supportingInfo: values.clinical_notes
                ? [
                    {
                      sequence: 1,
                      category: { coding: [{ code: 'clinicalnotes' }] },
                      valueString: values.clinical_notes,
                    },
                  ]
                : [],
            },
          },
        ],
      };
      return api.coordinateClaim(bundle, {
        'X-HCX-Sender-Code': values.provider_id,
        'X-HCX-Recipient-Code': values.payer_id,
        'X-HCX-Correlation-ID': claim_id,
        'X-HCX-Workflow-ID': 'provider-portal',
        'X-HCX-API-Call-ID': claim_id,
      });
    },
    onSuccess: (res) => {
      setSuccessInfo({
        claim_id: res.claim_id,
        correlation_id: res.correlation_id,
      });
      form.reset();
    },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
      </header>

      {successInfo && (
        <Alert variant="success">
          <AlertTitle>{t('success')}</AlertTitle>
          <AlertDescription>
            {tClaim('id')}: <strong>{successInfo.claim_id}</strong>
            <br />
            {t('correlationId')}: {successInfo.correlation_id}
          </AlertDescription>
        </Alert>
      )}

      <form
        onSubmit={form.handleSubmit((v) => submit.mutate(v))}
        className="space-y-6"
      >
        <Card>
          <CardHeader>
            <CardTitle>{tClaim('patientNid')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Controller
              control={form.control}
              name="patient_nid"
              render={({ field }) => (
                <PatientNidInput
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <div className="space-y-1.5">
              <Label htmlFor="claim-type">{t('claimType')}</Label>
              <select
                id="claim-type"
                {...form.register('claim_type')}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {['outpatient', 'inpatient', 'pharmacy', 'lab', 'dental', 'vision'].map(
                  (t2) => (
                    <option key={t2} value={t2}>
                      {t2}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payer-id">{tClaim('payer')}</Label>
              <Input id="payer-id" {...form.register('payer_id')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="provider-id">{tClaim('providerId')}</Label>
              <Input id="provider-id" {...form.register('provider_id')} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{tClaim('procedureCodes')}</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                append({
                  service_date: new Date().toISOString().slice(0, 10),
                  icd10_code: '',
                  procedure_code: '',
                  quantity: 1,
                  amount: 0,
                })
              }
            >
              <Plus className="size-4" />
              {t('addServiceLine')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {fields.map((field, index) => (
              <div
                key={field.id}
                className="grid grid-cols-1 gap-3 rounded-lg border border-border p-4 md:grid-cols-6"
              >
                <div className="md:col-span-1">
                  <Label>{tClaim('serviceDate')}</Label>
                  <Input
                    type="date"
                    {...form.register(`service_lines.${index}.service_date`)}
                  />
                </div>
                <div className="md:col-span-1">
                  <Label>ICD-10</Label>
                  <Input
                    placeholder="J06.9"
                    {...form.register(`service_lines.${index}.icd10_code`)}
                  />
                </div>
                <div className="md:col-span-1">
                  <Label>CPT</Label>
                  <Input
                    placeholder="99213"
                    {...form.register(`service_lines.${index}.procedure_code`)}
                  />
                </div>
                <div className="md:col-span-1">
                  <Label>Qty</Label>
                  <Input
                    type="number"
                    min={1}
                    {...form.register(`service_lines.${index}.quantity`)}
                  />
                </div>
                <div className="md:col-span-1">
                  <Label>{tc('amount')}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    {...form.register(`service_lines.${index}.amount`)}
                  />
                </div>
                <div className="flex items-end md:col-span-1">
                  {fields.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(index)}
                      aria-label="Remove line"
                    >
                      <Trash2 className="size-4 text-hcx-danger" aria-hidden />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{tClaim('clinicalNotes')}</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              rows={4}
              {...form.register('clinical_notes')}
              className="w-full rounded-md border border-input bg-background p-3 text-sm"
            />
          </CardContent>
        </Card>

        <Card className="sticky bottom-4 border-hcx-primary/30 shadow-md">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div>
              <p className="text-xs uppercase text-hcx-text-muted">
                {t('totalAmount')}
              </p>
              <p className="text-2xl font-bold tabular-nums text-hcx-text">
                {formatEgp(totalAmount, locale as 'ar' | 'en')}
              </p>
            </div>
            <Button
              type="submit"
              size="lg"
              disabled={submit.isPending}
              aria-busy={submit.isPending}
            >
              <Send className="size-4" />
              {t('submit')}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}

function claimTypeToFhir(t: string): string {
  switch (t) {
    case 'outpatient':
      return 'professional';
    case 'inpatient':
      return 'institutional';
    case 'pharmacy':
      return 'pharmacy';
    case 'dental':
      return 'oral';
    case 'vision':
      return 'vision';
    default:
      return 'professional';
  }
}
