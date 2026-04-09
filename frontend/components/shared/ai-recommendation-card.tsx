'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  Clock,
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
 * SRS §DS-AI-001 through §DS-AI-005 — consolidated AI analysis display.
 * Used in Payer Dashboard and SIU Portal as the primary surface for
 * AI-enriched claim data.
 */
export interface AIRecommendationCardProps {
  analysis: AICoordinateResponse;
  className?: string;
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
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <ConfidenceBar
            confidence={analysis.overall_confidence}
            label={t('confidence')}
          />
          {analysis.fraud?.fraud_score != null && (
            <FraudGauge
              score={analysis.fraud.fraud_score}
              size={140}
              showFactors
              factors={analysis.fraud.billing_pattern_flags ?? []}
            />
          )}
        </div>

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
              <div className="space-y-1 text-sm">
                <div>
                  <span className="text-hcx-text-muted">Status: </span>
                  <span>{analysis.eligibility.status}</span>
                </div>
                <div>
                  <span className="text-hcx-text-muted">Eligible: </span>
                  <span>{String(analysis.eligibility.is_eligible)}</span>
                </div>
                {analysis.eligibility.coverage_type && (
                  <div>
                    <span className="text-hcx-text-muted">Coverage: </span>
                    <span>{analysis.eligibility.coverage_type}</span>
                  </div>
                )}
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
                <div>
                  <span className="text-hcx-text-muted">All codes valid: </span>
                  <span>{String(analysis.coding.all_codes_valid)}</span>
                </div>
                {analysis.coding.confidence_score != null && (
                  <ConfidenceBar
                    confidence={analysis.coding.confidence_score}
                    showPercentage
                  />
                )}
                {analysis.coding.suggested_corrections?.length > 0 && (
                  <ul className="list-disc ps-5 text-xs">
                    {analysis.coding.suggested_corrections.map((c, i) => (
                      <li key={i}>{JSON.stringify(c)}</li>
                    ))}
                  </ul>
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
                <div>
                  <span className="text-hcx-text-muted">Score: </span>
                  <span className="numeric">
                    {analysis.fraud.fraud_score?.toFixed(2)}
                  </span>
                </div>
                {analysis.fraud.billing_pattern_flags?.length > 0 && (
                  <ul className="list-disc ps-5 text-xs">
                    {analysis.fraud.billing_pattern_flags.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
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
              <div className="space-y-1 text-sm">
                <div>
                  <span className="text-hcx-text-muted">Medically necessary: </span>
                  <span>{String(analysis.necessity.is_medically_necessary)}</span>
                </div>
                {analysis.necessity.arabic_summary && (
                  <p className="text-sm leading-relaxed">
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
