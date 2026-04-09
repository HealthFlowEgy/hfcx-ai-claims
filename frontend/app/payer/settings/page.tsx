'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Save, Settings as SettingsIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function PayerSettingsPage() {
  const t = useTranslations('payer.settings');
  const tc = useTranslations('common');

  const [rules, setRules] = useState({
    autoRoutingEnabled: true,
    autoApproveThreshold: 0.9,
    notifyOnHighRisk: true,
  });
  const [saved, setSaved] = useState(false);

  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

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
        <Button onClick={save}>
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
