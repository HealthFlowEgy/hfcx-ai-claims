'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Save, Settings as SettingsIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

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
    notifyOnHighRisk: true,
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setRules({
        autoRoutingEnabled: data.auto_routing_enabled,
        autoApproveThreshold: data.auto_approve_threshold,
        notifyOnHighRisk: data.notify_on_high_risk,
      });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updatePayerSettings({
        auto_routing_enabled: rules.autoRoutingEnabled,
        auto_approve_threshold: rules.autoApproveThreshold,
        notify_on_high_risk: rules.notifyOnHighRisk,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payer', 'settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="size-5 text-hcx-primary" aria-hidden />
            {t('adjudicationRules')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border p-3">
            <span className="text-sm font-medium">
              {t('autoRoutingEnabled')}
            </span>
            <input
              type="checkbox"
              checked={rules.autoRoutingEnabled}
              onChange={(e) =>
                setRules({ ...rules, autoRoutingEnabled: e.target.checked })
              }
              className="size-4"
            />
          </label>
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
              Claims with AI confidence ≥ this value AND fraud score &lt; 0.2
              are auto-approved (SRS §FR-PD-002).
            </p>
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border p-3">
            <span className="text-sm font-medium">
              Notify on high fraud risk
            </span>
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

      <div className="flex items-center gap-3">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          <Save className="size-4" aria-hidden />
          {t('save')}
        </Button>
        {saved && (
          <span className="text-sm text-hcx-success">{tc('confirm')} ✓</span>
        )}
      </div>
    </div>
  );
}
