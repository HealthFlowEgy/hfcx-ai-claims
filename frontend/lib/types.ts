/**
 * Frontend data contracts that mirror the backend Pydantic schemas in
 * src/models/schemas.py. Keep this file in sync with the backend — a
 * schemathesis contract test in the integration suite verifies the
 * OpenAPI definitions match at build time.
 */

export type ClaimType =
  | 'outpatient'
  | 'inpatient'
  | 'pharmacy'
  | 'lab'
  | 'dental'
  | 'vision';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type AgentStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'bypassed';

// ISSUE-007: Add all decision types
export type AdjudicationDecision =
  | 'approved'
  | 'denied'
  | 'pended'
  | 'partial'
  | 'voided'
  | 'settled'
  | 'investigating';

// ISSUE-007: Add 'partial' to ClaimStatus
export type ClaimStatus =
  | 'submitted'
  | 'in_review'
  | 'ai_analyzed'
  | 'approved'
  | 'denied'
  | 'partial'
  | 'investigating'
  | 'settled'
  | 'voided';

export interface EligibilityResult {
  status: AgentStatus;
  is_eligible: boolean | null;
  coverage_active: boolean | null;
  coverage_type: string | null;
  deductible_remaining: number | null;
  copay_percentage: number | null;
  exclusions: string[];
  cache_hit: boolean;
  checked_at: string;
  error_message: string | null;
}

export interface CodingValidationResult {
  status: AgentStatus;
  all_codes_valid: boolean | null;
  icd10_validations: Array<{
    code: string;
    format_valid?: boolean;
    semantic_valid?: boolean | null;
    description?: string | null;
    confidence?: number;
  }>;
  procedure_validations: Array<Record<string, unknown>>;
  suggested_corrections: Array<Record<string, unknown>>;
  confidence_score: number | null;
  arabic_entities_extracted: string[];
  ndp_prescription_check: Record<string, unknown> | null;
  error_message: string | null;
}

export interface FraudDetectionResult {
  status: AgentStatus;
  fraud_score: number | null;
  risk_level: RiskLevel | null;
  anomaly_flags: Array<{ detector: string; score: number }>;
  network_risk_indicators: string[];
  billing_pattern_flags: string[];
  isolation_forest_score: number | null;
  xgboost_score: number | null;
  pyod_ensemble_score: number | null;
  refer_to_siu: boolean;
  explanation: string | null;
  error_message: string | null;
}

export interface MedicalNecessityResult {
  status: AgentStatus;
  is_medically_necessary: boolean | null;
  confidence_score: number | null;
  supporting_evidence: string[];
  clinical_guidelines_referenced: string[];
  eda_formulary_status: string | null;
  alternative_suggestions: string[];
  arabic_summary: string | null;
  error_message: string | null;
}

export interface AICoordinateResponse {
  correlation_id: string;
  claim_id: string;
  adjudication_decision: AdjudicationDecision;
  overall_confidence: number;
  requires_human_review: boolean;
  human_review_reasons: string[];
  eligibility: EligibilityResult | null;
  coding: CodingValidationResult | null;
  fraud: FraudDetectionResult | null;
  necessity: MedicalNecessityResult | null;
  processing_time_ms: number;
  model_versions: Record<string, string>;
  fhir_extensions: Array<Record<string, unknown>>;
}

/* Lightweight "list row" shape returned by the analytics / list endpoints. */
export interface ClaimSummary {
  claim_id: string;
  correlation_id: string;
  patient_nid_masked: string;
  provider_id: string;
  payer_id: string;
  claim_type: ClaimType;
  total_amount: number;
  status: ClaimStatus;
  ai_risk_score: number | null;
  ai_recommendation: AdjudicationDecision | null;
  submitted_at: string;
  decided_at: string | null;
}

export interface ProviderSummary {
  claims_today: number;
  pending_responses: number;
  denial_rate_30d: number;
  payments_this_month_egp: number;
  claim_status_distribution: Array<{ status: ClaimStatus; count: number }>;
}

export interface PayerSummary {
  queue_depth: number;
  approval_rate: number;
  pending_preauth: number;
  avg_processing_minutes: number;
  by_ai_recommendation: Array<{ recommendation: string; count: number }>;
}

export interface SiuSummary {
  flagged_total: number;
  open_investigations: number;
  resolved_cases: number;
  fraud_savings_egp: number;
  risk_distribution: Array<{ risk: RiskLevel; count: number }>;
}

export interface RegulatorySummary {
  total_claims_volume: number;
  market_loss_ratio: number;
  market_denial_rate: number;
  avg_settlement_days: number;
  fraud_detection_rate: number;
  active_insurers: number;
  trend_by_month: Array<{ month: string; claims: number; denial_rate: number }>;
}

export interface NetworkGraphData {
  nodes: Array<{
    id: string;
    type: 'provider' | 'patient' | 'pharmacy';
    label: string;
    fraud_score?: number;
  }>;
  edges: Array<{ source: string; target: string; weight: number }>;
  clusters: Array<{ id: string; nodes: string[]; cluster_score: number }>;
}

export interface FeedbackStats {
  accuracy: number;
  precision_fraud: number;
  recall_fraud: number;
  drift: number;
  window_size: number;
}

export type UserRole =
  | 'provider_admin'
  | 'provider_billing'
  | 'payer_reviewer'
  | 'payer_admin'
  | 'siu_investigator'
  | 'fra_supervisor'
  | 'hcx_admin';

export interface SessionUser {
  id: string;
  name: string;
  organization: string;
  roles: UserRole[];
  email: string;
}
