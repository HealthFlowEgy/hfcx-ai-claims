'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Save, Settings as SettingsIcon, ShieldAlert } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

/**
 * Fix #36: Enhanced auto-adjudication rules with:
 *   - Configurable auto-approve threshold
 *   - Auto-deny threshold for high fraud risk
 *   - Fraud risk notification threshold
 *   - Rule preview/summary
 *   - Audit log of rule changes
 */

export default function PayerSettingsPage() {
  const t = useTranslations('payer.settings');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['payer', 'settings'],
    queryFn: () => api.payerSettings(),
  });

  const [rules, setRules] = useState({
    autoRoutingEnabled: true,
    autoApproveThreshold: 0.9,
    autoDenyFraudThreshold: 0.85,
    fraudNotifyThreshold: 0.6,
    notifyOnHighRisk: true,
    requireOverrideReason: true,
    maxAutoApproveAmount: 50000,
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setRules({
        autoRoutingEnabled: data.auto_routing_enabled ?? true,
        autoApproveThreshold: data.auto_approve_threshold ?? 0.9,
        autoDenyFraudThreshold: data.auto_deny_fraud_threshold ?? 0.85,
        fraudNotifyThreshold: data.fraud_notify_threshold ?? 0.6,
        notifyOnHighRisk: data.notify_on_high_risk ?? true,
        requireOverrideReason: data.require_override_reason ?? true,
        maxAutoApproveAmount: data.max_auto_approve_amount ?? 50000,
      });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updatePayerSettings({
        auto_routing_enabled: rules.autoRoutingEnabled,
        auto_approve_threshold: rules.autoApproveThreshold,
        auto_deny_fraud_threshold: rules.autoDenyFraudThreshold,
        fraud_notify_threshold: rules.fraudNotifyThreshold,
        notify_on_high_risk: rules.notifyOnHighRisk,
        require_override_reason: rules.requireOverrideReason,
        max_auto_approve_amount: rules.maxAutoApproveAmount,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payer', 'settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <p className="text-sm text-hcx-text-muted">{tc('loading')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-hcx-text">{t('title')}</h1>
        <p className="text-sm text-hcx-text-muted">Configure auto-adjudication rules, fraud thresholds, and notification preferences.</p>
      </header>

      {saved && (
        <Alert variant="success">
          <CheckCircle2 className="size-4" />
          <AlertTitle>Settings Saved</AlertTitle>
          <AlertDescription>Your adjudication rules have been updated successfully.</AlertDescription>
        </Alert>
      )}

      {/* Rule Preview */}
      <Card className="border-hcx-primary/30 bg-hcx-primary-light/10">
        <CardHeader>
          <CardTitle className="text-base">Rule Preview</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <p>
            {rules.autoRoutingEnabled
              ? `Auto-routing is ON. Claims with AI confidence >= ${(rules.autoApproveThreshold * 100).toFixed(0)}% and amount <= EGP ${rules.maxAutoApproveAmount.toLocaleString()} will be auto-approved.`
              : 'Auto-routing is OFF. All claims require manual review.'}
          </p>
          <p>
            {`Claims with fraud risk score >= ${(rules.autoDenyFraudThreshold * 100).toFixed(0)}% will be auto-flagged for SIU review.`}
          </p>
          {rules.notifyOnHighRisk && (
            <p>
              {`Notifications will be sent for claims with fraud risk >= ${(rules.fraudNotifyThreshold * 100).toFixed(0)}%.`}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Auto-Adjudication Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="size-5 text-hcx-primary" aria-hidden />
            {t('adjudicationRules')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border p-3">
            <div>
              <span className="text-sm font-medium">{t('autoRoutingEnabled')}</span>
              <p className="text-xs text-hcx-text-muted">Enable automatic claim routing based on AI analysis</p>
            </div>
            <input
              type="checkbox"
              checked={rules.autoRoutingEnabled}
              onChange={(e) =>
                setRules({ ...rules, autoRoutingEnabled: e.target.checked })
              }
              className="size-4"
            />
          </label>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="threshold">{t('autoApproveThreshold')}</Label>
              <Input
                id="threshold"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={rules.autoApproveThreshold}
                onChange={(e) =>
                  setRules({
                    ...rules,
                    autoApproveThreshold: Number(e.target.value),
                  })
                }
              />
              <p className="text-xs text-hcx-text-muted">
                Claims with AI confidence >= this value AND fraud score &lt; 0.2
                are auto-approved (SRS FR-PD-002).
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="maxAmount">Max Auto-Approve Amount (EGP)</Label>
              <Input
                id="maxAmount"
                type="number"
                min={0}
                step={1000}
                value={rules.maxAutoApproveAmount}
                onChange={(e) =>
                  setRules({
                    ...rules,
                    maxAutoApproveAmount: Number(e.target.value),
                  })
                }
              />
              <p className="text-xs text-hcx-text-muted">
                Claims above this amount always require manual review.
              </p>
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border p-3">
            <div>
              <span className="text-sm font-medium">Require Override Reason</span>
              <p className="text-xs text-hcx-text-muted">Mandate a reason when reviewer disagrees with AI recommendation</p>
            </div>
            <input
              type="checkbox"
              checked={rules.requireOverrideReason}
              onChange={(e) =>
                setRules({ ...rules, requireOverrideReason: e.target.checked })
              }
              className="size-4"
            />
          </label>
        </CardContent>
      </Card>

      {/* Fraud Detection Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-hcx-danger" aria-hidden />
            Fraud Detection Rules
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fraudThreshold">Auto-Flag Fraud Threshold</Label>
              <Input
                id="fraudThreshold"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={rules.autoDenyFraudThreshold}
                onChange={(e) =>
                  setRules({
                    ...rules,
                    autoDenyFraudThreshold: Number(e.target.value),
                  })
                }
              />
              <p className="text-xs text-hcx-text-muted">
                Claims with fraud risk >= this value are auto-flagged for SIU review.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notifyThreshold">Notification Threshold</Label>
              <Input
                id="notifyThreshold"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={rules.fraudNotifyThreshold}
                onChange={(e) =>
                  setRules({
                    ...rules,
                    fraudNotifyThreshold: Number(e.target.value),
                  })
                }
              />
              <p className="text-xs text-hcx-text-muted">
                Send alerts for claims with fraud risk >= this value.
              </p>
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border p-3">
            <div>
              <span className="text-sm font-medium">Notify on High Fraud Risk</span>
              <p className="text-xs text-hcx-text-muted">Send real-time alerts when high-risk claims are detected</p>
            </div>
            <input
              type="checkbox"
              checked={rules.notifyOnHighRisk}
              onChange={(e) =>
                setRules({ ...rules, notifyOnHighRisk: e.target.checked })
              }
              className="size-4"
            />
          </label>
        </CardContent>
      </Card>

      {/* Warning for aggressive settings */}
      {rules.autoApproveThreshold < 0.8 && (
        <Alert variant="warning">
          <AlertTriangle className="size-4" />
          <AlertTitle>Low Auto-Approve Threshold</AlertTitle>
          <AlertDescription>
            Setting the auto-approve threshold below 80% may result in claims being approved without sufficient AI confidence. Consider reviewing this setting.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          <Save className="size-4" aria-hidden />
          {t('save')}
        </Button>
        {saveMutation.isPending && (
          <span className="text-sm text-hcx-text-muted">Saving...</span>
        )}
      </div>
    </div>
  );
}
