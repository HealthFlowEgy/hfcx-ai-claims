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
  AICoordinateResponse,
  ClaimStatus,
  ClaimSummary,
  ClaimType,
  FeedbackStats,
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

const DEFAULT_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8090';

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
    response = await fetch(url, { ...opts, headers });
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

// ── Coordinator ──────────────────────────────────────────────────────
export const api = {
  coordinateClaim(
    fhirClaimBundle: unknown,
    hcxHeaders: Record<string, string>,
    opts: FetchOptions = {},
  ): Promise<AICoordinateResponse> {
    return request<AICoordinateResponse>('/internal/ai/coordinate', {
      method: 'POST',
      body: JSON.stringify({
        fhir_claim_bundle: fhirClaimBundle,
        hcx_headers: hcxHeaders,
      }),
      ...opts,
    });
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
};
