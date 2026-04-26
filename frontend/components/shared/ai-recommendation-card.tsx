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
  CheckCircle2,
  XCircle,
  Info,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { AICoordinateResponse } from '@/lib/types';

import { ConfidenceBar } from './confidence-bar';
import { FraudGauge } from './fraud-gauge';

/**
 * AI Recommendation Card — consolidated AI analysis display.
 * SRS §DS-AI-001 through §DS-AI-005.
 */
export interface AIRecommendationCardProps {
  analysis: AICoordinateResponse;
  className?: string;
}

function confidenceLabel(score: number): {
  text: string;
  color: string;
  bg: string;
} {
  if (score >= 0.9)
    return {
      text: 'Very High',
      color: 'text-emerald-700',
      bg: 'bg-emerald-50',
    };
  if (score >= 0.75)
    return {
      text: 'High',
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    };
  if (score >= 0.6)
    return {
      text: 'Moderate',
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    };
  if (score >= 0.4)
    return { text: 'Low', color: 'text-amber-700', bg: 'bg-amber-50' };
  return { text: 'Very Low', color: 'text-red-600', bg: 'bg-red-50' };
}

function generateExplanation(analysis: AICoordinateResponse): string {
  const parts: string[] = [];

  if (analysis.eligibility) {
    if (analysis.eligibility.is_eligible) {
      parts.push(
        `Patient is eligible for coverage (${analysis.eligibility.coverage_type || 'standard'}).`,
      );
    } else {
      parts.push(
        `Patient may not be eligible: ${analysis.eligibility.status}.`,
      );
    }
  }

  if (analysis.coding) {
    if (analysis.coding.all_codes_valid) {
      parts.push('All diagnosis and procedure codes are valid.');
    } else {
      const corrections =
        analysis.coding.suggested_corrections?.length ?? 0;
      parts.push(
        `Coding issues: ${corrections} correction${corrections !== 1 ? 's' : ''} suggested.`,
      );
    }
  }

  if (analysis.fraud) {
    const score = analysis.fraud.fraud_score ?? 0;
    if (score < 0.3) {
      parts.push('No significant fraud indicators.');
    } else if (score < 0.7) {
      parts.push(
        `Moderate fraud risk (${(score * 100).toFixed(0)}%) — review recommended.`,
      );
    } else {
      parts.push(
        `High fraud risk (${(score * 100).toFixed(0)}%) — investigation recommended.`,
      );
    }
  }

  if (analysis.necessity) {
    if (analysis.necessity.is_medically_necessary) {
      parts.push('Services appear medically necessary.');
    } else {
      parts.push(
        'Medical necessity not confirmed — additional documentation may be needed.',
      );
    }
  }

  return parts.join(' ');
}

function detectRuleOverrides(
  analysis: AICoordinateResponse,
): { active: boolean; rules: string[] } {
  const rules: string[] = [];
  if (
    analysis.overall_confidence >= 0.95 &&
    analysis.eligibility?.is_eligible &&
    analysis.coding?.all_codes_valid &&
    (analysis.fraud?.fraud_score ?? 0) < 0.1
  ) {
    rules.push(
      'Auto-approve: All checks passed with high confidence (>95%)',
    );
  }
  if (analysis.eligibility && !analysis.eligibility.is_eligible) {
    rules.push('Auto-deny: Patient eligibility check failed');
  }
  if ((analysis.fraud?.fraud_score ?? 0) >= 0.8) {
    rules.push(
      'Auto-flag for investigation: Fraud score exceeds 80% threshold',
    );
  }
  if (analysis.coding && !analysis.coding.all_codes_valid) {
    rules.push(
      'Pend for review: Coding validation failed — requires manual review',
    );
  }
  return { active: rules.length > 0, rules };
}

/* ── Badge config by recommendation ── */
const REC_CONFIG = {
  approved: {
    label: 'approve',
    variant: 'success' as const,
    headerBg: 'from-emerald-600 to-emerald-700',
    Icon: CheckCircle2,
  },
  denied: {
    label: 'deny',
    variant: 'destructive' as const,
    headerBg: 'from-red-600 to-red-700',
    Icon: XCircle,
  },
  pended: {
    label: 'investigate',
    variant: 'investigate' as const,
    headerBg: 'from-amber-600 to-amber-700',
    Icon: AlertTriangle,
  },
  _default: {
    label: 'none',
    variant: 'muted' as const,
    headerBg: 'from-slate-600 to-slate-700',
    Icon: Info,
  },
};

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
  const recCfg =
    REC_CONFIG[recommendation as keyof typeof REC_CONFIG] ??
    REC_CONFIG._default;

  const confLabel = confidenceLabel(analysis.overall_confidence);
  const explanation = generateExplanation(analysis);
  const ruleOverrides = detectRuleOverrides(analysis);
  const RecIcon = recCfg.Icon;

  return (
    <Card
      className={cn(
        'overflow-hidden border-0 shadow-lg',
        className,
      )}
    >
      {/* ── Header ── */}
      <div
        className={cn(
          'bg-gradient-to-r px-5 py-4 text-white',
          recCfg.headerBg,
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-white/20">
              <BrainCircuit className="size-4.5" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-wide">
                {t('recommendationBadge')}
              </h3>
              <p className="text-[11px] text-white/70">
                {t('disclaimer')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-white/20 px-3.5 py-1.5">
            <RecIcon className="size-4" />
            <span className="text-sm font-bold">{tr(recCfg.label)}</span>
          </div>
        </div>
      </div>

      <CardContent className="space-y-4 p-5">
        {/* ── AI Summary ── */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="size-3.5 text-hcx-primary" />
            <span className="text-xs font-bold uppercase tracking-wider text-hcx-primary">
              AI Summary
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-slate-700">
            {explanation}
          </p>
        </div>

        {/* ── Metrics Row ── */}
        <div className="grid grid-cols-2 gap-4">
          {/* Confidence */}
          <div
            className={cn(
              'rounded-lg border p-3.5',
              confLabel.bg,
              'border-current/10',
            )}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Confidence
              </span>
              <span
                className={cn(
                  'text-lg font-bold tabular-nums',
                  confLabel.color,
                )}
              >
                {(analysis.overall_confidence * 100).toFixed(0)}%
              </span>
            </div>
            <ConfidenceBar
              confidence={analysis.overall_confidence}
              showPercentage={false}
            />
            <p
              className={cn(
                'mt-1.5 text-[11px] font-semibold',
                confLabel.color,
              )}
            >
              {confLabel.text}
            </p>
          </div>

          {/* Fraud Gauge */}
          {analysis.fraud?.fraud_score != null && (
            <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2">
              <FraudGauge
                score={analysis.fraud.fraud_score}
                size={120}
              />
            </div>
          )}
        </div>

        {/* ── Human Review Warning ── */}
        {analysis.human_review_reasons?.length > 0 && (
          <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="space-y-1">
              <p className="text-xs font-bold text-amber-800">
                Human Review Required
              </p>
              {analysis.human_review_reasons.map((reason, i) => (
                <p
                  key={i}
                  className="text-[12px] leading-snug text-amber-700"
                >
                  {reason}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* ── Rule Overrides ── */}
        {ruleOverrides.active && (
          <div className="flex gap-3 rounded-lg border border-purple-200 bg-purple-50 p-3.5">
            <Gavel className="mt-0.5 size-4 shrink-0 text-purple-600" />
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-purple-800">
                Rule-Based Override Active
              </p>
              {ruleOverrides.rules.map((rule, i) => (
                <p
                  key={i}
                  className="text-[12px] leading-snug text-purple-700"
                >
                  {rule}
                </p>
              ))}
              <p className="text-[10px] italic text-purple-500">
                Applied automatically. Final decision remains with the
                reviewer.
              </p>
            </div>
          </div>
        )}

        {/* ── Agent Reasoning Accordions ── */}
        <div className="space-y-2">
          <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
            AI Reasoning
          </h4>

          <AgentAccordion
            title={t('eligibility')}
            Icon={ShieldCheck}
            open={open.eligibility}
            onToggle={() =>
              setOpen((s) => ({ ...s, eligibility: !s.eligibility }))
            }
            accentColor="emerald"
            status={
              analysis.eligibility
                ? analysis.eligibility.is_eligible
                  ? 'pass'
                  : 'fail'
                : 'none'
            }
          >
            {analysis.eligibility ? (
              <div className="space-y-2">
                <p className="text-[12px] leading-relaxed text-slate-600">
                  {analysis.eligibility.is_eligible
                    ? `Patient confirmed eligible with ${analysis.eligibility.coverage_type || 'standard'} coverage.`
                    : `Eligibility check returned "${analysis.eligibility.status}". Patient may not have active coverage.`}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                  <MetricRow
                    label="Status"
                    value={analysis.eligibility.status}
                  />
                  <MetricRow
                    label="Eligible"
                    value={
                      analysis.eligibility.is_eligible ? 'Yes' : 'No'
                    }
                    valueClass={
                      analysis.eligibility.is_eligible
                        ? 'text-emerald-600'
                        : 'text-red-600'
                    }
                  />
                  {analysis.eligibility.coverage_type && (
                    <MetricRow
                      label="Coverage"
                      value={analysis.eligibility.coverage_type}
                    />
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
            onToggle={() =>
              setOpen((s) => ({ ...s, coding: !s.coding }))
            }
            accentColor="blue"
            status={
              analysis.coding
                ? analysis.coding.all_codes_valid
                  ? 'pass'
                  : 'fail'
                : 'none'
            }
          >
            {analysis.coding ? (
              <div className="space-y-2">
                <p className="text-[12px] leading-relaxed text-slate-600">
                  {analysis.coding.all_codes_valid
                    ? 'All ICD-10 and CPT codes validated. No discrepancies found.'
                    : `Coding issues identified. ${analysis.coding.suggested_corrections?.length ?? 0} correction(s) suggested.`}
                </p>
                <MetricRow
                  label="All codes valid"
                  value={
                    analysis.coding.all_codes_valid ? 'Yes' : 'No'
                  }
                  valueClass={
                    analysis.coding.all_codes_valid
                      ? 'text-emerald-600'
                      : 'text-red-600'
                  }
                />
                {analysis.coding.confidence_score != null && (
                  <div className="space-y-1">
                    <ConfidenceBar
                      confidence={analysis.coding.confidence_score}
                      showPercentage
                      label="Coding Confidence"
                    />
                  </div>
                )}
                {analysis.coding.suggested_corrections?.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold text-slate-500">
                      Corrections:
                    </p>
                    <ul className="list-disc space-y-0.5 ps-4 text-[12px] text-slate-600">
                      {analysis.coding.suggested_corrections.map(
                        (c, i) => (
                          <li key={i}>
                            {typeof c === 'string'
                              ? c
                              : JSON.stringify(c)}
                          </li>
                        ),
                      )}
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
            onToggle={() =>
              setOpen((s) => ({ ...s, fraud: !s.fraud }))
            }
            accentColor="red"
            status={
              analysis.fraud
                ? (analysis.fraud.fraud_score ?? 0) >= 0.6
                  ? 'fail'
                  : 'pass'
                : 'none'
            }
          >
            {analysis.fraud ? (
              <div className="space-y-2">
                <p className="text-[12px] leading-relaxed text-slate-600">
                  {(analysis.fraud.fraud_score ?? 0) < 0.3
                    ? 'No significant fraud indicators. Billing patterns are consistent with norms.'
                    : (analysis.fraud.fraud_score ?? 0) < 0.7
                      ? `Moderate fraud risk (${((analysis.fraud.fraud_score ?? 0) * 100).toFixed(0)}%). Some billing pattern deviations detected.`
                      : `High fraud risk (${((analysis.fraud.fraud_score ?? 0) * 100).toFixed(0)}%). Multiple anomalies detected.`}
                </p>
                <MetricRow
                  label="Fraud Score"
                  value={`${((analysis.fraud.fraud_score ?? 0) * 100).toFixed(0)}%`}
                  valueClass={
                    (analysis.fraud.fraud_score ?? 0) < 0.3
                      ? 'text-emerald-600'
                      : (analysis.fraud.fraud_score ?? 0) < 0.7
                        ? 'text-amber-600'
                        : 'text-red-600'
                  }
                />
                {analysis.fraud.billing_pattern_flags?.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold text-slate-500">
                      Flagged Patterns:
                    </p>
                    <ul className="space-y-0.5 ps-3 text-[12px]">
                      {analysis.fraud.billing_pattern_flags.map(
                        (f, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-1.5 text-red-600"
                          >
                            <span className="mt-1.5 inline-block size-1 shrink-0 rounded-full bg-red-400" />
                            {f}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                )}
                {analysis.fraud.explanation && (
                  <p className="text-[11px] italic text-slate-500">
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
            onToggle={() =>
              setOpen((s) => ({ ...s, necessity: !s.necessity }))
            }
            accentColor="purple"
            status={
              analysis.necessity
                ? analysis.necessity.is_medically_necessary
                  ? 'pass'
                  : 'fail'
                : 'none'
            }
          >
            {analysis.necessity ? (
              <div className="space-y-2">
                <p className="text-[12px] leading-relaxed text-slate-600">
                  {analysis.necessity.is_medically_necessary
                    ? 'Services are consistent with the diagnosis and appear medically necessary.'
                    : 'Medical necessity not confirmed. Additional clinical documentation may be required.'}
                </p>
                <MetricRow
                  label="Medically necessary"
                  value={
                    analysis.necessity.is_medically_necessary
                      ? 'Yes'
                      : 'No'
                  }
                  valueClass={
                    analysis.necessity.is_medically_necessary
                      ? 'text-emerald-600'
                      : 'text-red-600'
                  }
                />
                {analysis.necessity.arabic_summary && (
                  <p
                    className="text-[12px] leading-relaxed text-slate-600"
                    dir="rtl"
                  >
                    {analysis.necessity.arabic_summary}
                  </p>
                )}
              </div>
            ) : (
              <EmptyAgent />
            )}
          </AgentAccordion>
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <Sparkles className="size-3" />
            {Object.entries(analysis.model_versions ?? {})
              .filter(([k]) => k !== 'app_version')
              .slice(0, 2)
              .map(([k, v]) => `${k}: ${v}`)
              .join(' \u2022 ') || t('modelVersion')}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="size-3" />
            {analysis.processing_time_ms}ms
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Agent Accordion ── */
const ACCENT_COLORS = {
  emerald: {
    border: 'border-l-emerald-500',
    bg: 'hover:bg-emerald-50/50',
    icon: 'text-emerald-600',
  },
  blue: {
    border: 'border-l-blue-500',
    bg: 'hover:bg-blue-50/50',
    icon: 'text-blue-600',
  },
  red: {
    border: 'border-l-red-500',
    bg: 'hover:bg-red-50/50',
    icon: 'text-red-600',
  },
  purple: {
    border: 'border-l-purple-500',
    bg: 'hover:bg-purple-50/50',
    icon: 'text-purple-600',
  },
};

function AgentAccordion({
  title,
  Icon,
  open,
  onToggle,
  children,
  accentColor,
  status,
}: {
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  accentColor: keyof typeof ACCENT_COLORS;
  status: 'pass' | 'fail' | 'none';
}) {
  const accent = ACCENT_COLORS[accentColor];
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-slate-200 border-l-[3px]',
        accent.border,
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors',
          accent.bg,
        )}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2.5">
          <Icon className={cn('size-4', accent.icon)} />
          <span className="text-slate-700">{title}</span>
        </span>
        <span className="flex items-center gap-2">
          {status === 'pass' && (
            <CheckCircle2 className="size-3.5 text-emerald-500" />
          )}
          {status === 'fail' && (
            <XCircle className="size-3.5 text-red-500" />
          )}
          {open ? (
            <ChevronUp className="size-3.5 text-slate-400" />
          ) : (
            <ChevronDown className="size-3.5 text-slate-400" />
          )}
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-100 bg-white px-3.5 py-3">
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Helpers ── */
function MetricRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-slate-500">{label}</span>
      <span className={cn('font-semibold text-slate-700', valueClass)}>
        {value}
      </span>
    </div>
  );
}

function EmptyAgent() {
  const t = useTranslations('common');
  return (
    <p className="text-[12px] italic text-slate-400">{t('noData')}</p>
  );
}
