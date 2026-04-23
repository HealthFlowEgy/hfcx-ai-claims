'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  Clock,
  Gavel,
  ShieldCheck,
  Sparkles,
  Stethoscope,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { AICoordinateResponse } from '@/lib/types';

import { ConfidenceBar } from './confidence-bar';
import { FraudGauge } from './fraud-gauge';

/**
 * Fix #50: Clear human-readable explanations for each AI agent
 * Fix #51: Confidence calibration with color-coded thresholds and interpretation
 * Fix #52: Rule-based override indicators
 *
 * SRS §DS-AI-001 through §DS-AI-005 — consolidated AI analysis display.
 */
export interface AIRecommendationCardProps {
  analysis: AICoordinateResponse;
  className?: string;
}

// Fix #51: Confidence interpretation helper
function confidenceLabel(score: number): { text: string; color: string } {
  if (score >= 0.9) return { text: 'Very High', color: 'text-hcx-success' };
  if (score >= 0.75) return { text: 'High', color: 'text-hcx-success' };
  if (score >= 0.6) return { text: 'Moderate', color: 'text-hcx-warning' };
  if (score >= 0.4) return { text: 'Low', color: 'text-hcx-warning' };
  return { text: 'Very Low', color: 'text-hcx-danger' };
}

// Fix #50: Generate human-readable explanation
function generateExplanation(analysis: AICoordinateResponse): string {
  const parts: string[] = [];

  if (analysis.eligibility) {
    if (analysis.eligibility.is_eligible) {
      parts.push(`The patient is eligible for coverage (${analysis.eligibility.coverage_type || 'standard'}).`);
    } else {
      parts.push(`The patient may not be eligible: ${analysis.eligibility.status}.`);
    }
  }

  if (analysis.coding) {
    if (analysis.coding.all_codes_valid) {
      parts.push('All diagnosis and procedure codes are valid and consistent.');
    } else {
      const corrections = analysis.coding.suggested_corrections?.length ?? 0;
      parts.push(`Coding issues detected: ${corrections} correction${corrections !== 1 ? 's' : ''} suggested.`);
    }
  }

  if (analysis.fraud) {
    const score = analysis.fraud.fraud_score ?? 0;
    if (score < 0.3) {
      parts.push('No significant fraud indicators detected.');
    } else if (score < 0.7) {
      parts.push(`Moderate fraud risk (${(score * 100).toFixed(0)}%) — review recommended.`);
    } else {
      parts.push(`High fraud risk (${(score * 100).toFixed(0)}%) — investigation strongly recommended.`);
    }
  }

  if (analysis.necessity) {
    if (analysis.necessity.is_medically_necessary) {
      parts.push('The services appear medically necessary based on the diagnosis.');
    } else {
      parts.push('Medical necessity could not be confirmed — additional documentation may be needed.');
    }
  }

  return parts.join(' ');
}

// Fix #52: Check if any rule-based overrides are active
function detectRuleOverrides(analysis: AICoordinateResponse): { active: boolean; rules: string[] } {
  const rules: string[] = [];

  // Check for auto-approve rules (high confidence + low fraud + eligible)
  if (
    analysis.overall_confidence >= 0.95 &&
    analysis.eligibility?.is_eligible &&
    analysis.coding?.all_codes_valid &&
    (analysis.fraud?.fraud_score ?? 0) < 0.1
  ) {
    rules.push('Auto-approve: All checks passed with high confidence (>95%)');
  }

  // Check for auto-deny rules (not eligible)
  if (analysis.eligibility && !analysis.eligibility.is_eligible) {
    rules.push('Auto-deny: Patient eligibility check failed');
  }

  // Check for auto-flag rules (high fraud score)
  if ((analysis.fraud?.fraud_score ?? 0) >= 0.8) {
    rules.push('Auto-flag for investigation: Fraud score exceeds 80% threshold');
  }

  // Check for coding mismatch rule
  if (analysis.coding && !analysis.coding.all_codes_valid) {
    rules.push('Pend for review: Coding validation failed — requires manual review');
  }

  return { active: rules.length > 0, rules };
}

export function AIRecommendationCard({
  analysis,
  className,
}: AIRecommendationCardProps) {
  const t = useTranslations('ai');
  const tr = useTranslations('recommendation');

  const [open, setOpen] = useState({
    eligibility: false,
    coding: false,
    fraud: false,
    necessity: false,
  });

  const recommendation = analysis.adjudication_decision;
  const recBadge =
    recommendation === 'approved'
      ? { label: tr('approve'), variant: 'success' as const }
      : recommendation === 'denied'
      ? { label: tr('deny'), variant: 'destructive' as const }
      : recommendation === 'pended'
      ? { label: tr('investigate'), variant: 'investigate' as const }
      : { label: tr('none'), variant: 'muted' as const };

  const confLabel = confidenceLabel(analysis.overall_confidence);
  const explanation = generateExplanation(analysis);
  const ruleOverrides = detectRuleOverrides(analysis);

  return (
    <Card className={cn('overflow-hidden border-hcx-primary/30', className)}>
      <CardHeader className="bg-hcx-primary-light/60">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <BrainCircuit className="size-5 text-hcx-primary" aria-hidden />
            <CardTitle className="text-lg">{t('recommendationBadge')}</CardTitle>
          </div>
          <Badge variant={recBadge.variant}>{recBadge.label}</Badge>
        </div>
        <p className="text-xs text-hcx-text-muted">{t('disclaimer')}</p>
      </CardHeader>

      <CardContent className="space-y-5 p-6">
        {/* Fix #50: Human-readable summary */}
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-xs font-semibold text-hcx-text-muted mb-1">AI Summary</p>
          <p className="text-sm leading-relaxed">{explanation}</p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Fix #51: Enhanced confidence display */}
          <div className="space-y-1">
            <ConfidenceBar
              confidence={analysis.overall_confidence}
              label={t('confidence')}
            />
            <div className="flex items-center justify-between text-xs">
              <span className={cn('font-semibold', confLabel.color)}>
                {confLabel.text} Confidence
              </span>
              <span className="text-hcx-text-muted">
                {(analysis.overall_confidence * 100).toFixed(0)}%
              </span>
            </div>
          </div>
          {analysis.fraud?.fraud_score != null && (
            <FraudGauge
              score={analysis.fraud.fraud_score}
              size={140}
              showFactors
              factors={analysis.fraud.billing_pattern_flags ?? []}
            />
          )}
        </div>

        {/* Fix #52: Rule-based override indicator */}
        {ruleOverrides.active && (
          <>
            <Separator />
            <div className="rounded-lg border border-hcx-warning/30 bg-hcx-warning/5 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Gavel className="size-4 text-hcx-warning" aria-hidden />
                <span className="text-sm font-semibold text-hcx-warning">
                  Rule-Based Override Active
                </span>
              </div>
              <ul className="space-y-1">
                {ruleOverrides.rules.map((rule, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="size-3 mt-0.5 text-hcx-warning shrink-0" />
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-hcx-text-muted italic">
                These rules are applied automatically based on configured thresholds. The final decision remains with the human reviewer.
              </p>
            </div>
          </>
        )}

        <Separator />

        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-hcx-text">{t('reasoning')}</h4>

          <AgentAccordion
            title={t('eligibility')}
            Icon={ShieldCheck}
            open={open.eligibility}
            onToggle={() => setOpen((s) => ({ ...s, eligibility: !s.eligibility }))}
          >
            {analysis.eligibility ? (
              <div className="space-y-2 text-sm">
                {/* Fix #50: Human-readable eligibility explanation */}
                <p className="text-xs leading-relaxed bg-muted/50 rounded p-2">
                  {analysis.eligibility.is_eligible
                    ? `Patient is confirmed eligible with ${analysis.eligibility.coverage_type || 'standard'} coverage. All eligibility criteria have been met.`
                    : `Eligibility check returned "${analysis.eligibility.status}". The patient may not have active coverage for the requested services.`}
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-hcx-text-muted">Status: </span>
                    <span className="font-medium">{analysis.eligibility.status}</span>
                  </div>
                  <div>
                    <span className="text-hcx-text-muted">Eligible: </span>
                    <span className={cn('font-medium', analysis.eligibility.is_eligible ? 'text-hcx-success' : 'text-hcx-danger')}>
                      {analysis.eligibility.is_eligible ? 'Yes' : 'No'}
                    </span>
                  </div>
                  {analysis.eligibility.coverage_type && (
                    <div>
                      <span className="text-hcx-text-muted">Coverage: </span>
                      <span className="font-medium">{analysis.eligibility.coverage_type}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <EmptyAgent />
            )}
          </AgentAccordion>

          <AgentAccordion
            title={t('coding')}
            Icon={Sparkles}
            open={open.coding}
            onToggle={() => setOpen((s) => ({ ...s, coding: !s.coding }))}
          >
            {analysis.coding ? (
              <div className="space-y-2 text-sm">
                {/* Fix #50: Human-readable coding explanation */}
                <p className="text-xs leading-relaxed bg-muted/50 rounded p-2">
                  {analysis.coding.all_codes_valid
                    ? 'All submitted ICD-10 and CPT codes have been validated. No coding discrepancies were found.'
                    : `Coding validation identified issues. ${analysis.coding.suggested_corrections?.length ?? 0} correction(s) are suggested below. Please review before proceeding.`}
                </p>
                <div>
                  <span className="text-hcx-text-muted text-xs">All codes valid: </span>
                  <span className={cn('text-xs font-medium', analysis.coding.all_codes_valid ? 'text-hcx-success' : 'text-hcx-danger')}>
                    {analysis.coding.all_codes_valid ? 'Yes' : 'No'}
                  </span>
                </div>
                {analysis.coding.confidence_score != null && (
                  <div className="space-y-1">
                    <ConfidenceBar
                      confidence={analysis.coding.confidence_score}
                      showPercentage
                    />
                    <span className={cn('text-xs font-medium', confidenceLabel(analysis.coding.confidence_score).color)}>
                      {confidenceLabel(analysis.coding.confidence_score).text}
                    </span>
                  </div>
                )}
                {analysis.coding.suggested_corrections?.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold">Suggested Corrections:</p>
                    <ul className="list-disc ps-5 text-xs space-y-1">
                      {analysis.coding.suggested_corrections.map((c, i) => (
                        <li key={i} className="text-hcx-text-muted">
                          {typeof c === 'string' ? c : JSON.stringify(c)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <EmptyAgent />
            )}
          </AgentAccordion>

          <AgentAccordion
            title={t('fraud')}
            Icon={BrainCircuit}
            open={open.fraud}
            onToggle={() => setOpen((s) => ({ ...s, fraud: !s.fraud }))}
          >
            {analysis.fraud ? (
              <div className="space-y-2 text-sm">
                {/* Fix #50: Human-readable fraud explanation */}
                <p className="text-xs leading-relaxed bg-muted/50 rounded p-2">
                  {(analysis.fraud.fraud_score ?? 0) < 0.3
                    ? 'This claim shows no significant fraud indicators. Billing patterns are consistent with expected norms for this type of service.'
                    : (analysis.fraud.fraud_score ?? 0) < 0.7
                    ? `This claim has a moderate fraud risk score of ${((analysis.fraud.fraud_score ?? 0) * 100).toFixed(0)}%. Some billing patterns deviate from expected norms. Manual review is recommended.`
                    : `This claim has a high fraud risk score of ${((analysis.fraud.fraud_score ?? 0) * 100).toFixed(0)}%. Multiple billing pattern anomalies were detected. Investigation is strongly recommended.`}
                </p>
                <div>
                  <span className="text-hcx-text-muted text-xs">Fraud Score: </span>
                  <span className={cn(
                    'text-xs font-bold',
                    (analysis.fraud.fraud_score ?? 0) < 0.3 ? 'text-hcx-success'
                      : (analysis.fraud.fraud_score ?? 0) < 0.7 ? 'text-hcx-warning'
                      : 'text-hcx-danger',
                  )}>
                    {((analysis.fraud.fraud_score ?? 0) * 100).toFixed(0)}%
                  </span>
                </div>
                {analysis.fraud.billing_pattern_flags?.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold">Flagged Patterns:</p>
                    <ul className="list-disc ps-5 text-xs space-y-1">
                      {analysis.fraud.billing_pattern_flags.map((f, i) => (
                        <li key={i} className="text-hcx-danger">{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {analysis.fraud.explanation && (
                  <p className="text-xs italic text-hcx-text-muted">
                    {analysis.fraud.explanation}
                  </p>
                )}
              </div>
            ) : (
              <EmptyAgent />
            )}
          </AgentAccordion>

          <AgentAccordion
            title={t('necessity')}
            Icon={Stethoscope}
            open={open.necessity}
            onToggle={() => setOpen((s) => ({ ...s, necessity: !s.necessity }))}
          >
            {analysis.necessity ? (
              <div className="space-y-2 text-sm">
                {/* Fix #50: Human-readable necessity explanation */}
                <p className="text-xs leading-relaxed bg-muted/50 rounded p-2">
                  {analysis.necessity.is_medically_necessary
                    ? 'The requested services are consistent with the diagnosis and appear medically necessary based on established clinical guidelines.'
                    : 'Medical necessity could not be confirmed based on the submitted information. Additional clinical documentation may be required to support the services rendered.'}
                </p>
                <div>
                  <span className="text-hcx-text-muted text-xs">Medically necessary: </span>
                  <span className={cn('text-xs font-medium', analysis.necessity.is_medically_necessary ? 'text-hcx-success' : 'text-hcx-danger')}>
                    {analysis.necessity.is_medically_necessary ? 'Yes' : 'No'}
                  </span>
                </div>
                {analysis.necessity.arabic_summary && (
                  <p className="text-sm leading-relaxed" dir="rtl">
                    {analysis.necessity.arabic_summary}
                  </p>
                )}
              </div>
            ) : (
              <EmptyAgent />
            )}
          </AgentAccordion>
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-2 text-xs text-hcx-text-muted">
          <span className="flex items-center gap-1.5">
            <Sparkles className="size-3.5" aria-hidden />
            {Object.entries(analysis.model_versions ?? {})
              .filter(([k]) => k !== 'app_version')
              .slice(0, 2)
              .map(([k, v]) => `${k}: ${v}`)
              .join(' • ') || t('modelVersion')}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5" aria-hidden />
            {analysis.processing_time_ms}ms
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function AgentAccordion({
  title,
  Icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 p-3 text-sm font-medium hover:bg-accent"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Icon className="size-4 text-hcx-primary" aria-hidden />
          {title}
        </span>
        {open ? (
          <ChevronUp className="size-4" aria-hidden />
        ) : (
          <ChevronDown className="size-4" aria-hidden />
        )}
      </button>
      {open && <div className="border-t border-border p-3">{children}</div>}
    </div>
  );
}

function EmptyAgent() {
  const t = useTranslations('common');
  return <p className="text-sm text-hcx-text-muted">{t('noData')}</p>;
}
