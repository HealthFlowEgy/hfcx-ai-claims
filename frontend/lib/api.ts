/**
 * API client for the HFCX AI backend.
 *
 * Every request carries:
 *   - Authorization: Bearer <service JWT>   (injected by the BFF layer)
 *   - X-HCX-Correlation-ID   (generated per request unless provided)
 *   - Accept-Language        (ar|en from next-intl)
 *
 * Errors are normalized to a single ApiError shape so the UI can handle
 * them uniformly (SRS §9.3 error handling table).
 */
import type {
  AdjudicationDecision,
  AICoordinateResponse,
  ClaimStatus,
  ClaimSummary,
  ClaimType,
  CodingValidationResult,
  EligibilityResult,
  FeedbackStats,
  FraudDetectionResult,
  MedicalNecessityResult,
  NetworkGraphData,
  PayerSummary,
  ProviderSummary,
  RegulatorySummary,
  SiuSummary,
} from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const DIRECT_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8090';

// In the browser, route through the Next.js BFF proxy so the HttpOnly
// session cookie is automatically injected as a Bearer token.
// On the server (SSR), call the backend directly.
const isBrowser = typeof window !== 'undefined';
const DEFAULT_API_BASE = isBrowser ? '/api/proxy' : DIRECT_API_BASE;

function generateCorrelationId(): string {
  // Short correlation ID — matches X-HCX-Correlation-ID format.
  return `fe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface FetchOptions extends RequestInit {
  correlationId?: string;
  token?: string;
  locale?: 'ar' | 'en';
}

async function request<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const correlationId = opts.correlationId ?? generateCorrelationId();
  const headers = new Headers(opts.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('X-HCX-Correlation-ID', correlationId);
  if (opts.locale) headers.set('Accept-Language', opts.locale);
  if (opts.token) headers.set('Authorization', `Bearer ${opts.token}`);

  const url = `${DEFAULT_API_BASE}${path}`;
  let response: Response;
  try {
    // 5-minute timeout for AI inference calls (self-hosted Ollama models)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300_000);
    response = await fetch(url, { ...opts, headers, signal: controller.signal });
    clearTimeout(timeoutId);
  } catch (exc) {
    throw new ApiError(0, 'ERR-NET', (exc as Error).message, correlationId);
  }

  if (!response.ok) {
    let code = 'ERR-UNKNOWN';
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body?.detail === 'string') {
        message = body.detail;
      } else if (body?.error) {
        code = String(body.error);
        message = body.message ?? message;
      }
    } catch {
      /* body is not JSON */
    }
    throw new ApiError(response.status, code, message, correlationId);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }
  return (await response.json()) as T;
}

// ── Helpers ─────────────────────────────────────────────────────
function normalizeCoordinateResponse(raw: Record<string, unknown>): AICoordinateResponse {
  return {
    correlation_id: (raw.correlation_id as string) ?? '',
    claim_id: (raw.claim_id as string) ?? '',
    adjudication_decision: (raw.adjudication_decision as AdjudicationDecision) ?? 'pended',
    overall_confidence: (raw.overall_confidence as number) ?? 0,
    requires_human_review: (raw.requires_human_review as boolean) ?? true,
    human_review_reasons: (raw.human_review_reasons as string[]) ?? [],
    eligibility: (raw.eligibility as EligibilityResult | undefined) ?? null,
    coding: (raw.coding as CodingValidationResult | undefined) ?? null,
    fraud: (raw.fraud_detection ?? raw.fraud) as FraudDetectionResult | undefined ?? null,
    necessity: (raw.medical_necessity ?? raw.necessity) as MedicalNecessityResult | undefined ?? null,
    processing_time_ms: (raw.processing_time_ms as number) ?? 0,
    model_versions: (raw.model_versions as Record<string, string>) ?? {},
    fhir_extensions: (raw.fhir_extensions as Array<Record<string, unknown>>) ?? [],
  };
}

// ── Coordinator ──────────────────────────────────────────────────────
export const api = {
  /**
   * Submit a claim for AI analysis using the async endpoint.
   * Returns immediately with a claim_id, then polls for the result.
   * Falls back to the synchronous endpoint if async is unavailable.
   */
  async coordinateClaim(
    fhirClaimBundle: unknown,
    hcxHeaders: Record<string, string>,
    opts: FetchOptions & { onProgress?: (status: string) => void } = {},
  ): Promise<AICoordinateResponse> {
    const { onProgress, ...fetchOpts } = opts;

    // Step 1: Submit asynchronously
    let submitResult: Record<string, unknown>;
    try {
      submitResult = await request('/internal/ai/coordinate/async', {
        method: 'POST',
        body: JSON.stringify({
          fhir_claim_bundle: fhirClaimBundle,
          hcx_headers: hcxHeaders,
        }),
        ...fetchOpts,
      });
    } catch {
      // Fallback to synchronous endpoint if async is not available
      const raw = await request<Record<string, unknown>>('/internal/ai/coordinate', {
        method: 'POST',
        body: JSON.stringify({
          fhir_claim_bundle: fhirClaimBundle,
          hcx_headers: hcxHeaders,
        }),
        ...fetchOpts,
      });
      return normalizeCoordinateResponse(raw);
    }

    const claimId = submitResult.claim_id as string;
    if (!claimId) {
      throw new ApiError(0, 'ERR-NO-CLAIM-ID', 'No claim_id returned from async submit', '');
    }

    // Step 2: Poll for result every 5 seconds, up to 6 minutes
    const maxPolls = 72; // 72 * 5s = 360s = 6 minutes
    for (let i = 0; i < maxPolls; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000));

      onProgress?.(`Processing AI analysis... (${(i + 1) * 5}s)`);

      try {
        const status = await request<Record<string, unknown>>(`/internal/ai/coordinate/status/${claimId}`, {
          ...fetchOpts,
        });

        if (status.status === 'completed' && status.result) {
          return normalizeCoordinateResponse(status.result as Record<string, unknown>);
        }
        if (status.status === 'failed') {
          throw new ApiError(503, 'ERR-AI-FAILED', (status.error as string) || 'AI processing failed', claimId);
        }
        // status === 'processing' → continue polling
      } catch (err) {
        // If it's a 404, the claim hasn't been registered yet — keep polling
        if (err instanceof ApiError && err.status === 404) continue;
        throw err;
      }
    }

    throw new ApiError(0, 'ERR-TIMEOUT', 'AI analysis timed out after 6 minutes', claimId);
  },

  // ── Direct agent endpoints ──────────────────────────────────────────
  verifyEligibility(
    payload: {
      patient_id: string;
      payer_id: string;
      provider_id: string;
      service_date: string;
      claim_type: ClaimType;
    },
    opts: FetchOptions = {},
  ) {
    return request('/internal/ai/agents/eligibility/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
      ...opts,
    });
  },

  validateCoding(
    payload: {
      diagnosis_codes: string[];
      procedure_codes: string[];
      drug_codes?: string[];
      clinical_notes?: string;
      claim_type: ClaimType;
    },
    opts: FetchOptions = {},
  ) {
    return request('/internal/ai/agents/coding/validate', {
      method: 'POST',
      body: JSON.stringify(payload),
      ...opts,
    });
  },

  scoreFraud(
    payload: {
      claim_id: string;
      provider_id: string;
      patient_id: string;
      total_amount: number;
      diagnosis_codes: string[];
      procedure_codes: string[];
      claim_date: string;
      service_date: string;
      claim_type: ClaimType;
    },
    opts: FetchOptions = {},
  ) {
    return request('/internal/ai/agents/fraud/score', {
      method: 'POST',
      body: JSON.stringify(payload),
      ...opts,
    });
  },

  // ── Portal data (BFF routes — see src/api/routes/bff.py) ────────────
  providerSummary(opts: FetchOptions = {}): Promise<ProviderSummary> {
    return request<ProviderSummary>('/internal/ai/bff/provider/summary', opts);
  },

  payerSummary(opts: FetchOptions = {}): Promise<PayerSummary> {
    return request<PayerSummary>('/internal/ai/bff/payer/summary', opts);
  },

  siuSummary(opts: FetchOptions = {}): Promise<SiuSummary> {
    return request<SiuSummary>('/internal/ai/bff/siu/summary', opts);
  },

  regulatorySummary(opts: FetchOptions = {}): Promise<RegulatorySummary> {
    return request<RegulatorySummary>(
      '/internal/ai/bff/regulatory/summary',
      opts,
    );
  },

  listClaims(
    params: {
      portal: 'provider' | 'payer' | 'siu';
      status?: ClaimStatus[];
      limit?: number;
      offset?: number;
      search?: string;
    },
    opts: FetchOptions = {},
  ): Promise<{ items: ClaimSummary[]; total: number }> {
    const qs = new URLSearchParams();
    qs.set('portal', params.portal);
    if (params.status?.length) qs.set('status', params.status.join(','));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    if (params.search) qs.set('search', params.search);
    return request<{ items: ClaimSummary[]; total: number }>(
      `/internal/ai/bff/claims?${qs.toString()}`,
      opts,
    );
  },

  networkGraph(
    params: {
      fraud_min?: number;
      governorate?: string;
      since?: string;
    } = {},
    opts: FetchOptions = {},
  ): Promise<NetworkGraphData> {
    const qs = new URLSearchParams();
    if (params.fraud_min != null) qs.set('fraud_min', String(params.fraud_min));
    if (params.governorate) qs.set('governorate', params.governorate);
    if (params.since) qs.set('since', params.since);
    return request<NetworkGraphData>(
      `/internal/ai/bff/siu/network?${qs.toString()}`,
      opts,
    );
  },

  submitFeedback(
    payload: {
      correlation_id: string;
      ai_decision: string;
      human_decision: string;
      ai_score?: number;
      model?: string;
    },
    opts: FetchOptions = {},
  ): Promise<FeedbackStats> {
    return request<FeedbackStats>('/internal/ai/feedback', {
      method: 'POST',
      body: JSON.stringify(payload),
      ...opts,
    });
  },

  providerDenials(opts: FetchOptions = {}) {
    return request<{
      categories: Array<{ category: string; count: number; total_egp: number }>;
      items: Array<{
        claim_id: string;
        correlation_id: string;
        claim_type: string;
        total_amount: number;
        denied_on: string;
        reason: string;
        ai_appeal_summary: string;
      }>;
    }>('/internal/ai/bff/provider/denials', opts);
  },

  payerAnalytics(opts: FetchOptions = {}) {
    return request<{
      loss_ratio: number;
      approval_rate: number;
      avg_processing_minutes: number;
      fraud_detection_rate: number;
      top_denial_reasons: Array<{ reason: string; count: number }>;
      claims_by_type: Array<{ type: string; count: number }>;
    }>('/internal/ai/bff/payer/analytics', opts);
  },

  siuInvestigations(opts: FetchOptions = {}) {
    return request<
      Array<{
        case_id: string;
        correlation_id: string;
        assigned_to: string | null;
        workflow_status: string;
        opened_on: string;
        financial_impact_egp: number;
        provider_id: string;
      }>
    >('/internal/ai/bff/siu/investigations', opts);
  },

  siuCrossPayerSearch(
    payload: {
      provider_id?: string;
      patient_nid_hash?: string;
      icd10_code?: string;
      procedure_code?: string;
      limit?: number;
    },
    opts: FetchOptions = {},
  ) {
    return request<
      Array<{
        claim_id: string;
        correlation_id: string;
        payer_id: string;
        provider_id: string;
        total_amount: number;
        claim_type: string;
        submitted_at: string;
        is_potential_duplicate: boolean;
      }>
    >('/internal/ai/bff/siu/search', {
      method: 'POST',
      body: JSON.stringify(payload),
      ...opts,
    });
  },

  regulatoryInsurers(opts: FetchOptions = {}) {
    return request<
      Array<{
        name: string;
        claims_volume: number;
        loss_ratio: number;
        denial_rate: number;
        processing_time_days: number;
        fraud_rate: number;
        ai_accuracy: number;
      }>
    >('/internal/ai/bff/regulatory/insurers', opts);
  },

  regulatoryGeographic(opts: FetchOptions = {}) {
    return request<
      Array<{
        governorate: string;
        claims: number;
        denials: number;
        fraud_rate: number;
      }>
    >('/internal/ai/bff/regulatory/geographic', opts);
  },

  regulatoryCompliance(opts: FetchOptions = {}) {
    return request<
      Array<{
        insurer: string;
        compliance_score: number;
        last_audit: string;
        status: string;
      }>
    >('/internal/ai/bff/regulatory/compliance', opts);
  },

  // ── Provider communications ────────────────────────────────────────────
  providerCommunications(opts: FetchOptions = {}) {
    return request<{
      threads: Array<{
        id: string;
        subject: string;
        payer: string;
        claim_id: string;
        unread: boolean;
        messages: Array<{
          id: string;
          from_name: string;
          direction: 'inbound' | 'outbound';
          body: string;
          sent_at: string;
        }>;
      }>;
    }>('/internal/ai/bff/provider/communications', opts);
  },

  // ── Provider payments ──────────────────────────────────────────────────
  providerPayments(opts: FetchOptions = {}) {
    return request<{
      items: Array<{
        payment_ref: string;
        claim_id: string;
        paid_on: string;
        settled_amount: number;
        method: string;
        reconciled: boolean;
      }>;
    }>('/internal/ai/bff/provider/payments', opts);
  },

  // ── Provider pre-auth ──────────────────────────────────────────────────
  providerPreauth(opts: FetchOptions = {}) {
    return request<{
      items: Array<{
        request_id: string;
        claim_type: string;
        patient_nid_masked: string;
        icd10: string;
        procedure: string;
        amount: number;
        status: string;
        requested_at: string;
        authorized_qty?: number;
        auth_number?: string;
        valid_until?: string;
        justification?: string;
      }>;
    }>('/internal/ai/bff/provider/preauth', opts);
  },

  createPreauth(
    payload: {
      patient_nid: string;
      icd10: string;
      procedure: string;
      amount: number;
      justification?: string;
    },
    opts: FetchOptions = {},
  ) {
    return request<{
      request_id: string;
      claim_type: string;
      patient_nid_masked: string;
      icd10: string;
      procedure: string;
      amount: number;
      status: string;
      requested_at: string;
      justification?: string;
    }>('/internal/ai/bff/provider/preauth', {
      method: 'POST',
      body: JSON.stringify(payload),
      ...opts,
    });
  },

  // ── Provider settings ──────────────────────────────────────────────────
  providerSettings(opts: FetchOptions = {}) {
    return request<{
      profile: {
        name: string;
        organization: string;
        email: string;
        language: string;
      };
      notifications: {
        denial: boolean;
        payment: boolean;
        comms: boolean;
      };
    }>('/internal/ai/bff/provider/settings', opts);
  },

  updateProviderSettings(
    payload: {
      profile: {
        name: string;
        organization: string;
        email: string;
        language: string;
      };
      notifications: {
        denial: boolean;
        payment: boolean;
        comms: boolean;
      };
    },
    opts: FetchOptions = {},
  ) {
    return request<{
      profile: {
        name: string;
        organization: string;
        email: string;
        language: string;
      };
      notifications: {
        denial: boolean;
        payment: boolean;
        comms: boolean;
      };
    }>('/internal/ai/bff/provider/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
      ...opts,
    });
  },

  // ── Payer communications ───────────────────────────────────────────────
  payerCommunications(opts: FetchOptions = {}) {
    return request<{
      threads: Array<{
        id: string;
        subject: string;
        claim_id: string;
        provider: string;
        sent_at: string;
        awaiting_response: boolean;
      }>;
    }>('/internal/ai/bff/payer/communications', opts);
  },

  // ── Payer settings ─────────────────────────────────────────────────────
  payerSettings(opts: FetchOptions = {}) {
    return request<{
      auto_routing_enabled: boolean;
      auto_approve_threshold: number;
      notify_on_high_risk: boolean;
    }>('/internal/ai/bff/payer/settings', opts);
  },

  updatePayerSettings(
    payload: {
      auto_routing_enabled: boolean;
      auto_approve_threshold: number;
      notify_on_high_risk: boolean;
    },
    opts: FetchOptions = {},
  ) {
    return request<{
      auto_routing_enabled: boolean;
      auto_approve_threshold: number;
      notify_on_high_risk: boolean;
    }>('/internal/ai/bff/payer/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
      ...opts,
    });
  },

  // ── SIU reports ────────────────────────────────────────────────────────
  siuReports(opts: FetchOptions = {}) {
    return request<{
      items: Array<{
        id: string;
        type: string;
        generated_at: string;
        size_kb: number;
      }>;
    }>('/internal/ai/bff/siu/reports', opts);
  },

  generateSiuReport(
    payload: { type: string },
    opts: FetchOptions = {},
  ) {
    return request<{
      id: string;
      type: string;
      generated_at: string;
      size_kb: number;
    }>('/internal/ai/bff/siu/reports/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
      ...opts,
    });
  },

  // ── Regulatory reports ─────────────────────────────────────────────────
  regulatoryReports(opts: FetchOptions = {}) {
    return request<{
      items: Array<{
        id: string;
        type: string;
        period: string;
        generated_at: string;
        size_kb: number;
        status: string;
      }>;
    }>('/internal/ai/bff/regulatory/reports', opts);
  },

  generateRegulatoryReport(
    payload: { type: string },
    opts: FetchOptions = {},
  ) {
    return request<{
      id: string;
      type: string;
      period: string;
      generated_at: string;
      size_kb: number;
      status: string;
    }>('/internal/ai/bff/regulatory/reports/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
      ...opts,
    });
  },
};
