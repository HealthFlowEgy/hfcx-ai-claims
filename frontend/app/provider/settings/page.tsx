'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Save, User } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

export default function ProviderSettingsPage() {
  const t = useTranslations('provider.settings');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['provider', 'settings'],
    queryFn: () => api.providerSettings(),
  });

  const [profile, setProfile] = useState({
    name: '',
    organization: '',
    email: '',
    language: 'ar',
  });
  const [notifications, setNotifications] = useState({
    denial: true,
    payment: true,
    comms: false,
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setProfile(data.profile);
      setNotifications(data.notifications);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateProviderSettings({ profile, notifications }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider', 'settings'] });
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
            <User className="size-5 text-hcx-primary" aria-hidden />
            {t('profile')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org">{t('organization')}</Label>
            <Input
              id="org"
              value={profile.organization}
              onChange={(e) =>
                setProfile({ ...profile, organization: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('contactEmail')}</Label>
            <Input
              id="email"
              type="email"
              dir="ltr"
              value={profile.email}
              onChange={(e) =>
                setProfile({ ...profile, email: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lang">{t('languagePref')}</Label>
            <select
              id="lang"
              value={profile.language}
              onChange={(e) =>
                setProfile({ ...profile, language: e.target.value })
              }
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('notifications')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border p-3">
            <span className="text-sm font-medium">{t('notifyDenial')}</span>
            <input
              type="checkbox"
              checked={notifications.denial}
              onChange={(e) =>
                setNotifications({ ...notifications, denial: e.target.checked })
              }
              className="size-4"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border p-3">
            <span className="text-sm font-medium">{t('notifyPayment')}</span>
            <input
              type="checkbox"
              checked={notifications.payment}
              onChange={(e) =>
                setNotifications({ ...notifications, payment: e.target.checked })
              }
              className="size-4"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border p-3">
            <span className="text-sm font-medium">{t('notifyComms')}</span>
            <input
              type="checkbox"
              checked={notifications.comms}
              onChange={(e) =>
                setNotifications({ ...notifications, comms: e.target.checked })
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
