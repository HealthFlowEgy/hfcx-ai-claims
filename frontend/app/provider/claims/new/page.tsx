'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
} from 'react-hook-form';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2, Plus, Send, Trash2 } from 'lucide-react';
import { z } from 'zod';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CodeSelector } from '@/components/shared/code-selector';
import { PatientNidInput } from '@/components/shared/patient-nid-input';
import { AIRecommendationCard } from '@/components/shared/ai-recommendation-card';
import { api } from '@/lib/api';
import type { AICoordinateResponse } from '@/lib/types';
import { formatEgp } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

/**
 * SRS §4.2.2 — New Claim Submission form.
 *
 * Flow: NID → eligibility → claim type → service lines → submit.
 * After submission, the full AI adjudication results are displayed
 * using the AIRecommendationCard component.
 */

const serviceLineSchema = z.object({
  service_date: z.string().min(1, 'Service date is required'),
  icd10_code: z.string().regex(/^[A-Z]\d{2}(\.\d{1,4})?$/i, 'Invalid ICD-10 code (e.g. J06.9)'),
  procedure_code: z.string().min(1, 'Procedure code is required'),
  quantity: z.coerce.number().int().positive('Quantity must be positive'),
  amount: z.coerce.number().nonnegative('Amount must be non-negative'),
});

const claimSchema = z.object({
  patient_nid: z.string().regex(/^\d{14}$/, 'National ID must be exactly 14 digits'),
  claim_type: z.enum([
    'outpatient',
    'inpatient',
    'pharmacy',
    'lab',
    'dental',
    'vision',
  ]),
  payer_id: z.string().min(1, 'Payer ID is required'),
  provider_id: z.string().min(1, 'Provider ID is required'),
  service_lines: z.array(serviceLineSchema).min(1, 'At least one service line is required'),
  clinical_notes: z.string().optional(),
  prescription_id: z.string().optional(),
});

type ClaimFormValues = z.infer<typeof claimSchema>;

/** Inline field error message component */
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-hcx-danger" role="alert">
      <AlertCircle className="size-3 shrink-0" />
      {message}
    </p>
  );
}

export default function NewClaimPage() {
  const t = useTranslations('provider.newClaim');
  const tc = useTranslations('common');
  const tClaim = useTranslations('claim');
  const locale = useLocale();

  const router = useRouter();
  const [aiResult, setAiResult] = useState<AICoordinateResponse | null>(null);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [submittedClaimId, setSubmittedClaimId] = useState<string | null>(null);

  const form = useForm<ClaimFormValues>({
    resolver: zodResolver(claimSchema),
    defaultValues: {
      patient_nid: '',
      claim_type: 'outpatient',
      payer_id: 'GIG',
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
      prescription_id: '',
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'service_lines',
  });

  const watchedLines = useWatch({
    control: form.control,
    name: 'service_lines',
  });

  const watchedClaimType = useWatch({
    control: form.control,
    name: 'claim_type',
  });

  const totalAmount = useMemo(
    () =>
      (watchedLines ?? []).reduce(
        (sum, line) =>
          sum + Number(line?.amount || 0) * Number(line?.quantity || 1),
        0,
      ),
    [watchedLines],
  );

  const isPharmacy = watchedClaimType === 'pharmacy';

  const submit = useMutation({
    mutationFn: async (values: ClaimFormValues) => {
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
              prescription: values.prescription_id
                ? [{ reference: `MedicationRequest/${values.prescription_id}` }]
                : [],
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
      // Fire-and-forget: submit async, return immediately
      return api.submitClaimAsync(bundle, {
        'X-HCX-Sender-Code': values.provider_id,
        'X-HCX-Recipient-Code': values.payer_id,
        'X-HCX-Correlation-ID': claim_id,
        'X-HCX-Workflow-ID': 'provider-portal',
        'X-HCX-API-Call-ID': claim_id,
      });
    },
    onSuccess: (res) => {
      setSubmittedClaimId(res.claim_id);
      setProgressMsg('');
      toast({
        title: 'Claim Submitted',
        description: (
          `Claim ${res.claim_id} accepted. `
          + 'AI analysis is running in the background.'
        ),
        variant: 'success',
      });
      // Redirect to claims list after a brief delay
      setTimeout(() => router.push('/provider/claims'), 2000);
    },
    onError: (error) => {
      setProgressMsg('');
      toast({
        title: 'Submission Failed',
        description: (
          error instanceof Error
            ? error.message
            : 'An error occurred while submitting the claim.'
        ),
        variant: 'destructive',
      });
    },
  });

  // Show instant confirmation after fire-and-forget submission
  if (submittedClaimId && !aiResult) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        </header>
        <Alert variant="success">
          <CheckCircle2 className="h-5 w-5" />
          <AlertTitle>Claim Submitted Successfully</AlertTitle>
          <AlertDescription>
            Claim <strong>{submittedClaimId}</strong> has been accepted.
            AI analysis is running in the background.
            <br />
            You will be redirected to the claims list shortly.
            The Payer Portal will be updated automatically once
            the analysis is complete.
          </AlertDescription>
        </Alert>
        <div className="flex items-center gap-2 text-sm text-hcx-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Redirecting to claims list...
        </div>
      </div>
    );
  }

  // If we have AI results, show them prominently
  if (aiResult) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        </header>

        <Alert variant="success">
          <AlertTitle>{t('success')}</AlertTitle>
          <AlertDescription>
            {tClaim('id')}: <strong>{aiResult.claim_id}</strong>
            <br />
            {t('correlationId')}: {aiResult.correlation_id}
          </AlertDescription>
        </Alert>

        {/* Full AI Analysis Results */}
        <AIRecommendationCard analysis={aiResult} />

        {/* Processing details */}
        <Card>
          <CardHeader>
            <CardTitle>Adjudication Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <div>
                <p className="text-hcx-text-muted">Decision</p>
                <p className="text-lg font-bold capitalize">{aiResult.adjudication_decision}</p>
              </div>
              <div>
                <p className="text-hcx-text-muted">Confidence</p>
                <p className="text-lg font-bold">{(aiResult.overall_confidence * 100).toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-hcx-text-muted">Processing Time</p>
                <p className="text-lg font-bold">{aiResult.processing_time_ms}ms</p>
              </div>
              <div>
                <p className="text-hcx-text-muted">Human Review</p>
                <p className="text-lg font-bold">{aiResult.requires_human_review ? 'Required' : 'Not Required'}</p>
              </div>
            </div>
            {aiResult.human_review_reasons.length > 0 && (
              <div className="rounded-lg border border-hcx-warning/40 bg-hcx-warning/5 p-3">
                <p className="mb-1 text-sm font-medium text-hcx-warning">Review Reasons:</p>
                <ul className="list-disc ps-5 text-sm">
                  {aiResult.human_review_reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => {
              setAiResult(null);
              form.reset();
            }}
          >
            Submit Another Claim
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
      </header>

      {submit.isError && (
        <Alert variant="destructive">
          <AlertTitle>Submission Failed</AlertTitle>
          <AlertDescription>
            {submit.error instanceof Error ? submit.error.message : 'An error occurred while processing the claim. Please try again.'}
          </AlertDescription>
        </Alert>
      )}

      <form
        onSubmit={form.handleSubmit(
          (v) => submit.mutate(v),
          (errors) => {
            // Show toast when validation fails so user knows something went wrong
            const errorCount = Object.keys(errors).length;
            const serviceLineErrors = errors.service_lines;
            let totalErrors = errorCount;
            if (Array.isArray(serviceLineErrors)) {
              totalErrors += serviceLineErrors.filter(Boolean).length - 1;
            }
            toast({
              title: 'Validation Error',
              description: `Please fix ${totalErrors} error${totalErrors > 1 ? 's' : ''} in the form before submitting.`,
              variant: 'destructive',
            });
          },
        )}
        className="space-y-6"
      >
        <Card>
          <CardHeader>
            <CardTitle>{tClaim('patientNid')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Controller
                control={form.control}
                name="patient_nid"
                render={({ field, fieldState }) => (
                  <div>
                    <PatientNidInput
                      value={field.value}
                      onChange={field.onChange}
                    />
                    <FieldError message={fieldState.error?.message} />
                  </div>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="claim-type">{t('claimType')}</Label>
              <select
                id="claim-type"
                {...form.register('claim_type')}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {/* ISSUE-067: Use translated labels for claim types */}
                {['outpatient', 'inpatient', 'pharmacy', 'lab', 'dental', 'vision'].map(
                  (t2) => (
                    <option key={t2} value={t2}>
                      {tClaim(`types.${t2}`)}
                    </option>
                  ),
                )}
              </select>
              <FieldError message={form.formState.errors.claim_type?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payer-id">{tClaim('payer')}</Label>
              <select
                id="payer-id"
                {...form.register('payer_id')}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="GIG">GIG Insurance - Egypt</option>
                <option value="AXA">AXA Insurance - Egypt</option>
                <option value="Allianz">Allianz Insurance - Egypt</option>
                <option value="Orient">Orient Insurance - Egypt</option>
                <option value="MetLife">MetLife Insurance - Egypt</option>
                <option value="Mohandes">Mohandes Insurance - Egypt</option>
              </select>
              <FieldError message={form.formState.errors.payer_id?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="provider-id">{tClaim('providerId')}</Label>
              <Input id="provider-id" {...form.register('provider_id')} />
              <FieldError message={form.formState.errors.provider_id?.message} />
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
                className="grid grid-cols-1 gap-3 rounded-lg border border-border p-4 md:grid-cols-8"
              >
                <div className="md:col-span-1">
                  <Label>{tClaim('serviceDate')}</Label>
                  <Input
                    type="date"
                    {...form.register(`service_lines.${index}.service_date`)}
                  />
                  <FieldError message={form.formState.errors.service_lines?.[index]?.service_date?.message} />
                </div>
                <div className="md:col-span-2">
                  <Label>ICD-10</Label>
                  <Controller
                    control={form.control}
                    name={`service_lines.${index}.icd10_code`}
                    render={({ field, fieldState }) => (
                      <div>
                        <CodeSelector
                          value={field.value}
                          onChange={field.onChange}
                          codeType="icd10"
                        />
                        <FieldError message={fieldState.error?.message} />
                      </div>
                    )}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>CPT</Label>
                  <Controller
                    control={form.control}
                    name={`service_lines.${index}.procedure_code`}
                    render={({ field, fieldState }) => (
                      <div>
                        <CodeSelector
                          value={field.value}
                          onChange={field.onChange}
                          codeType="cpt"
                          placeholder="Search CPT code or procedure..."
                        />
                        <FieldError message={fieldState.error?.message} />
                      </div>
                    )}
                  />
                  
                </div>
                <div className="md:col-span-1">
                  <Label>Qty</Label>
                  <Input
                    type="number"
                    min={1}
                    {...form.register(`service_lines.${index}.quantity`)}
                  />
                  <FieldError message={form.formState.errors.service_lines?.[index]?.quantity?.message} />
                </div>
                <div className="md:col-span-1">
                  <Label>{tc('amount')}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    {...form.register(`service_lines.${index}.amount`)}
                  />
                  <FieldError message={form.formState.errors.service_lines?.[index]?.amount?.message} />
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

        {isPharmacy && (
          <Card className="border-hcx-warning/40">
            <CardHeader>
              <CardTitle>NDP Prescription</CardTitle>
            </CardHeader>
            <CardContent>
              <Label htmlFor="prescription-id">Prescription ID</Label>
              <Input
                id="prescription-id"
                placeholder="RX-EG-2026-001"
                {...form.register('prescription_id')}
                aria-required
              />
              <p className="mt-1 text-xs text-hcx-text-muted">
                FR-MC-003 — required for pharmacy claims. The backend
                cross-validates against NDP before adjudication.
              </p>
            </CardContent>
          </Card>
        )}

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
              {submit.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {progressMsg || 'Processing AI Analysis...'}
                </>
              ) : (
                <>
                  <Send className="size-4" />
                  {t('submit')}
                </>
              )}
            </Button>
            {submit.isPending && progressMsg && (
              <p className="mt-2 text-center text-sm text-hcx-text-muted">
                AI analysis is running on self-hosted models. This typically takes 2–4 minutes.
              </p>
            )}
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
    case 'lab':
      return 'professional';
    case 'dental':
      return 'oral';
    case 'vision':
      return 'vision';
    default:
      return 'professional';
  }
}
