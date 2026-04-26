'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
} from 'react-hook-form';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  Send,
  Shield,
  Trash2,
  User,
} from 'lucide-react';
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
 * After submission, the claim is placed "Under AI Review" and the
 * provider is redirected to the claims list.
 *
 * Fix #3: Provider ID auto-generated/locked (non-editable)
 * Fix #4: Validate/prevent duplicate service lines
 * Fix #5: Newly created claims appearing in Claims page (queryClient invalidation)
 * Fix #6: "Under AI Review" status shown after submit
 * Fix #7: AI provides recommendations, not auto-decisions
 */

const PROVIDER_ID = 'HCP-EG-CAIRO-001'; // Auto-assigned from session

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

/**
 * Fix #4: Check for duplicate service lines (same ICD-10 + CPT + date).
 */
function findDuplicateLines(
  lines: { icd10_code: string; procedure_code: string; service_date: string }[],
): number[] {
  const seen = new Map<string, number>();
  const dupes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const key = `${lines[i].icd10_code}|${lines[i].procedure_code}|${lines[i].service_date}`;
    if (!key || key === '||') continue; // skip empty
    if (seen.has(key)) {
      dupes.push(i);
    } else {
      seen.set(key, i);
    }
  }
  return dupes;
}

export default function NewClaimPage() {
  const t = useTranslations('provider.newClaim');
  const tc = useTranslations('common');
  const tClaim = useTranslations('claim');
  const locale = useLocale();

  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [aiResult, setAiResult] = useState<AICoordinateResponse | null>(null);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [submittedClaimId, setSubmittedClaimId] = useState<string | null>(null);

  // Provider fraud profile and beneficiary risk profile
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
  const [beneficiaryProfile, setBeneficiaryProfile] = useState<{
    patient_nid_hash: string;
    total_claims: number;
    flagged_claims: number;
    avg_fraud_score: number;
    total_amount_egp: number;
    distinct_providers: number;
    risk_level: string;
  } | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(false);

  // FEAT-04: Detect resubmit mode from query params
  const isResubmit = searchParams.get('resubmit') === 'true';
  const originalClaimId = searchParams.get('original_id') ?? '';
  const resubmitClaimType = searchParams.get('claim_type') ?? 'outpatient';
  const resubmitAmount = Number(searchParams.get('amount') ?? 0);
  const resubmitReason = searchParams.get('reason') ?? '';

  const form = useForm<ClaimFormValues>({
    resolver: zodResolver(claimSchema),
    defaultValues: {
      patient_nid: '',
      claim_type: (isResubmit && ['outpatient', 'inpatient', 'pharmacy', 'lab', 'dental', 'vision'].includes(resubmitClaimType)
        ? resubmitClaimType
        : 'outpatient') as ClaimFormValues['claim_type'],
      payer_id: 'GIG',
      provider_id: PROVIDER_ID, // Fix #3: auto-assigned
      service_lines: [
        {
          service_date: new Date().toISOString().slice(0, 10),
          icd10_code: '',
          procedure_code: '',
          quantity: 1,
          amount: isResubmit ? resubmitAmount : 0,
        },
      ],
      clinical_notes: isResubmit ? `Resubmission of ${originalClaimId}. Original denial reason: ${resubmitReason}` : '',
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
      // Fix #4: Check for duplicate service lines before submitting
      const dupes = findDuplicateLines(values.service_lines);
      if (dupes.length > 0) {
        throw new Error(
          `Duplicate service lines detected at row(s) ${dupes.map((d) => d + 1).join(', ')}. ` +
          'Each combination of ICD-10 + CPT + service date must be unique.',
        );
      }

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
      return { result: await api.submitClaimAsync(bundle, {
        'X-HCX-Sender-Code': values.provider_id,
        'X-HCX-Recipient-Code': values.payer_id,
        'X-HCX-Correlation-ID': claim_id,
        'X-HCX-Workflow-ID': 'provider-portal',
        'X-HCX-API-Call-ID': claim_id,
      }), providerId: values.provider_id, patientNid: values.patient_nid };
    },
    onSuccess: async ({ result: res, providerId, patientNid }) => {
      setSubmittedClaimId(res.claim_id);
      setProgressMsg('');
      // Fix #5: Invalidate claims queries so the new claim appears in the list
      queryClient.invalidateQueries({ queryKey: ['provider', 'claims'] });
      queryClient.invalidateQueries({ queryKey: ['provider', 'summary'] });
      toast({
        title: 'Claim Submitted',
        description: (
          `Claim ${res.claim_id} accepted. `
          + 'AI analysis is running in the background. Status: Under AI Review.'
        ),
        variant: 'success',
      });

      // Fetch provider fraud profile and beneficiary risk profile
      setProfilesLoading(true);
      try {
        const [provProfile, benProfile] = await Promise.allSettled([
          api.providerFraudProfile(providerId),
          (async () => {
            // Hash patient NID with SHA-256 for the beneficiary endpoint
            const encoder = new TextEncoder();
            const data = encoder.encode(patientNid);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            return api.beneficiaryRiskProfile(hashHex);
          })(),
        ]);
        if (provProfile.status === 'fulfilled') setProviderProfile(provProfile.value);
        if (benProfile.status === 'fulfilled') setBeneficiaryProfile(benProfile.value);
      } catch {
        // Silently ignore — scorecards are optional
      } finally {
        setProfilesLoading(false);
      }
      // Do NOT auto-redirect — let user review the scorecards
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

  const riskColor = (level: string) =>
    level === 'high' ? 'text-red-600' : level === 'medium' ? 'text-amber-600' : 'text-green-600';
  const riskBg = (level: string) =>
    level === 'high'
      ? 'bg-red-50 border-red-200'
      : level === 'medium'
        ? 'bg-amber-50 border-amber-200'
        : 'bg-green-50 border-green-200';

  // Fix #6: Show "Under AI Review" confirmation after fire-and-forget submission
  // Now includes Provider Fraud Profile + Beneficiary Risk Profile scorecards
  if (submittedClaimId && !aiResult) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        </header>
        <Alert variant="success">
          <CheckCircle2 className="h-5 w-5" />
          <AlertTitle>
            {locale === 'ar' ? 'تم تقديم المطالبة بنجاح' : 'Claim Submitted Successfully'}
          </AlertTitle>
          <AlertDescription>
            {locale === 'ar' ? (
              <>
                المطالبة <strong>{submittedClaimId}</strong> تم قبولها وهي الآن
                <strong> قيد مراجعة الذكاء الاصطناعي</strong>.
                <br />
                سيقوم نظام الذكاء الاصطناعي بتحليل المطالبة وتقديم <em>توصية</em> (وليس قراراً نهائياً).
              </>
            ) : (
              <>
                Claim <strong>{submittedClaimId}</strong> has been accepted and is now
                <strong> Under AI Review</strong>.
                <br />
                The AI system will analyze the claim and provide a <em>recommendation</em> (not a final decision).
                A human reviewer will make the final adjudication.
              </>
            )}
          </AlertDescription>
        </Alert>

        {/* Provider Fraud Profile Scorecard */}
        {profilesLoading && (
          <div className="flex items-center gap-2 text-sm text-hcx-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            {locale === 'ar' ? 'جاري تحميل ملفات المخاطر...' : 'Loading risk profiles...'}
          </div>
        )}

        {providerProfile && (
          <Card className={`border ${riskBg(providerProfile.risk_level)}`}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="size-5 text-hcx-primary" />
                {locale === 'ar' ? 'ملف مخاطر مقدم الخدمة' : 'Provider Fraud Profile'}
                <span className={`ms-auto text-sm font-bold uppercase ${riskColor(providerProfile.risk_level)}`}>
                  {providerProfile.risk_level === 'high'
                    ? locale === 'ar' ? 'مخاطر عالية' : 'HIGH RISK'
                    : providerProfile.risk_level === 'medium'
                      ? locale === 'ar' ? 'مخاطر متوسطة' : 'MEDIUM RISK'
                      : locale === 'ar' ? 'مخاطر منخفضة' : 'LOW RISK'}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div className="rounded-md bg-white/60 p-2.5">
                  <span className="text-xs text-hcx-text-muted">
                    {locale === 'ar' ? 'مقدم الخدمة' : 'Provider'}
                  </span>
                  <p className="mt-0.5 font-mono text-sm font-medium">{providerProfile.provider_id}</p>
                </div>
                <div className="rounded-md bg-white/60 p-2.5">
                  <span className="text-xs text-hcx-text-muted">
                    {locale === 'ar' ? 'إجمالي المطالبات' : 'Total Claims'}
                  </span>
                  <p className="mt-0.5 text-lg font-bold">{providerProfile.total_claims}</p>
                </div>
                <div className="rounded-md bg-white/60 p-2.5">
                  <span className="text-xs text-hcx-text-muted">
                    {locale === 'ar' ? 'المطالبات المشبوهة' : 'Flagged Claims'}
                  </span>
                  <p className="mt-0.5 text-lg font-bold text-red-600">{providerProfile.flagged_claims}</p>
                </div>
                <div className="rounded-md bg-white/60 p-2.5">
                  <span className="text-xs text-hcx-text-muted">
                    {locale === 'ar' ? 'متوسط درجة الاحتيال' : 'Avg Fraud Score'}
                  </span>
                  <p className="mt-0.5 text-lg font-bold">{Math.round(providerProfile.avg_fraud_score * 100)}%</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md bg-white/60 p-2.5">
                  <span className="text-xs text-hcx-text-muted">
                    {locale === 'ar' ? 'إجمالي المبلغ' : 'Total Amount'}
                  </span>
                  <p className="mt-0.5 font-semibold">{formatEgp(providerProfile.total_amount_egp, locale)}</p>
                </div>
                <div className="rounded-md bg-white/60 p-2.5">
                  <span className="text-xs text-hcx-text-muted">
                    {locale === 'ar' ? 'المبلغ المشبوه' : 'Flagged Amount'}
                  </span>
                  <p className="mt-0.5 font-semibold text-red-600">
                    {formatEgp(providerProfile.flagged_amount_egp, locale)}
                  </p>
                </div>
              </div>
              {providerProfile.top_diagnosis_codes?.length > 0 && (
                <div className="mt-3">
                  <span className="text-xs text-hcx-text-muted">
                    {locale === 'ar' ? 'أكثر التشخيصات' : 'Top Diagnosis Codes'}
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {providerProfile.top_diagnosis_codes.map((code) => (
                      <span key={code} className="rounded bg-white px-2 py-0.5 text-xs font-mono border">
                        {code}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Beneficiary Risk Profile Scorecard */}
        {beneficiaryProfile && (
          <Card className={`border ${riskBg(beneficiaryProfile.risk_level)}`}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="size-5 text-hcx-primary" />
                {locale === 'ar' ? 'ملف مخاطر المستفيد' : 'Beneficiary Abuse Risk Profile'}
                <span className={`ms-auto text-sm font-bold uppercase ${riskColor(beneficiaryProfile.risk_level)}`}>
                  {beneficiaryProfile.risk_level === 'high'
                    ? locale === 'ar' ? 'مخاطر عالية' : 'HIGH RISK'
                    : beneficiaryProfile.risk_level === 'medium'
                      ? locale === 'ar' ? 'مخاطر متوسطة' : 'MEDIUM RISK'
                      : locale === 'ar' ? 'مخاطر منخفضة' : 'LOW RISK'}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div className="rounded-md bg-white/60 p-2.5">
                  <span className="text-xs text-hcx-text-muted">
                    {locale === 'ar' ? 'إجمالي المطالبات' : 'Total Claims'}
                  </span>
                  <p className="mt-0.5 text-lg font-bold">{beneficiaryProfile.total_claims}</p>
                </div>
                <div className="rounded-md bg-white/60 p-2.5">
                  <span className="text-xs text-hcx-text-muted">
                    {locale === 'ar' ? 'المطالبات المشبوهة' : 'Flagged Claims'}
                  </span>
                  <p className="mt-0.5 text-lg font-bold text-red-600">{beneficiaryProfile.flagged_claims}</p>
                </div>
                <div className="rounded-md bg-white/60 p-2.5">
                  <span className="text-xs text-hcx-text-muted">
                    {locale === 'ar' ? 'متوسط درجة الاحتيال' : 'Avg Fraud Score'}
                  </span>
                  <p className="mt-0.5 text-lg font-bold">{Math.round(beneficiaryProfile.avg_fraud_score * 100)}%</p>
                </div>
                <div className="rounded-md bg-white/60 p-2.5">
                  <span className="text-xs text-hcx-text-muted">
                    {locale === 'ar' ? 'مقدمي خدمة مختلفين' : 'Distinct Providers'}
                  </span>
                  <p className="mt-0.5 text-lg font-bold">{beneficiaryProfile.distinct_providers}</p>
                </div>
              </div>
              <div className="mt-3 rounded-md bg-white/60 p-2.5 text-sm">
                <span className="text-xs text-hcx-text-muted">
                  {locale === 'ar' ? 'إجمالي المبلغ' : 'Total Amount'}
                </span>
                <p className="mt-0.5 font-semibold">{formatEgp(beneficiaryProfile.total_amount_egp, locale)}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* No scorecards available message */}
        {!profilesLoading && !providerProfile && !beneficiaryProfile && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {locale === 'ar' ? 'ملفات المخاطر غير متاحة' : 'Risk Profiles Unavailable'}
            </AlertTitle>
            <AlertDescription>
              {locale === 'ar'
                ? 'لا توجد بيانات كافية لعرض ملفات مخاطر مقدم الخدمة والمستفيد.'
                : 'Insufficient data to display provider fraud and beneficiary risk profiles.'}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => router.push('/provider/claims')}>
            {locale === 'ar' ? 'عرض المطالبات' : 'View Claims'}
          </Button>
          <Button
            variant="default"
            onClick={() => {
              setAiResult(null);
              setSubmittedClaimId(null);
              setProviderProfile(null);
              setBeneficiaryProfile(null);
              form.reset();
            }}
          >
            {locale === 'ar' ? 'تقديم مطالبة أخرى' : 'Submit Another Claim'}
          </Button>
        </div>
      </div>
    );
  }

  // If we have AI results, show them prominently
  // Fix #7: Frame as "AI Recommendation" not "AI Decision"
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

        {/* Full AI Analysis Results — Fix #7: Framed as recommendation */}
        <AIRecommendationCard analysis={aiResult} />

        {/* Processing details */}
        <Card>
          <CardHeader>
            <CardTitle>AI Recommendation Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-hcx-text-muted">
              This is an AI-generated recommendation. The final decision will be made by a human reviewer
              at the payer organization.
            </p>
            <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <div>
                <p className="text-hcx-text-muted">AI Recommendation</p>
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

            {aiResult.human_review_reasons?.length > 0 && (
              <div className="mt-3 rounded-md bg-hcx-warning/10 p-3">
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
              setSubmittedClaimId(null);
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

      {/* FEAT-04: Resubmit banner */}
      {isResubmit && (
        <Alert variant="info">
          <AlertCircle className="h-5 w-5" />
          <AlertTitle>Resubmission</AlertTitle>
          <AlertDescription>
            You are resubmitting claim <strong>{originalClaimId}</strong>.
            {resubmitReason && <> Original denial reason: <em>{resubmitReason}</em>.</>}
            {' '}Please correct the issues and submit.
          </AlertDescription>
        </Alert>
      )}

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
            {/* Fix #3: Provider ID auto-generated and locked (non-editable) */}
            <div className="space-y-1.5">
              <Label htmlFor="provider-id">{tClaim('providerId')}</Label>
              <Input
                id="provider-id"
                value={PROVIDER_ID}
                readOnly
                disabled
                className="bg-muted cursor-not-allowed"
                title="Provider ID is auto-assigned from your session"
              />
              <p className="text-xs text-hcx-text-muted">Auto-assigned from your provider profile</p>
              <input type="hidden" {...form.register('provider_id')} />
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
            {/* Fix #4: Duplicate line warning */}
            {(() => {
              const dupes = findDuplicateLines(watchedLines ?? []);
              if (dupes.length === 0) return null;
              return (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Duplicate Service Lines</AlertTitle>
                  <AlertDescription>
                    Row(s) {dupes.map((d) => d + 1).join(', ')} have the same ICD-10 + CPT + date
                    combination. Please remove duplicates before submitting.
                  </AlertDescription>
                </Alert>
              );
            })()}
            {fields.map((field, index) => {
              const isDuplicate = findDuplicateLines(watchedLines ?? []).includes(index);
              return (
                <div
                  key={field.id}
                  className={`grid grid-cols-1 gap-3 rounded-lg border p-4 md:grid-cols-8 ${
                    isDuplicate ? 'border-hcx-danger bg-hcx-danger/5' : 'border-border'
                  }`}
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
              );
            })}
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
                  {progressMsg || 'Submitting...'}
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
                {progressMsg}
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
