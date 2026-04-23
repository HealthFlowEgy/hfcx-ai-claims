'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Bell, CheckCircle2, Save, Shield, User } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

/**
 * Fix #21: Enhanced notification preferences with granular controls
 *   - Denial alerts, payment notifications, pre-auth updates, communications
 *   - Email vs in-app toggle for each
 * Fix #22: Profile editing with validation and success feedback
 *   - Name, organization, email, language, phone
 *   - Validation for email format
 *   - Success toast on save
 */

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
    phone: '',
    language: 'ar',
  });
  const [notifications, setNotifications] = useState({
    denial: true,
    payment: true,
    comms: false,
    preauth: true,
    emailAlerts: true,
    inAppAlerts: true,
  });
  const [saved, setSaved] = useState(false);
  const [emailError, setEmailError] = useState('');

  useEffect(() => {
    if (data) {
      setProfile({
        name: data.profile?.name ?? '',
        organization: data.profile?.organization ?? '',
        email: data.profile?.email ?? '',
        phone: data.profile?.phone ?? '',
        language: data.profile?.language ?? 'ar',
      });
      setNotifications({
        denial: data.notifications?.denial ?? true,
        payment: data.notifications?.payment ?? true,
        comms: data.notifications?.comms ?? false,
        preauth: data.notifications?.preauth ?? true,
        emailAlerts: data.notifications?.emailAlerts ?? true,
        inAppAlerts: data.notifications?.inAppAlerts ?? true,
      });
    }
  }, [data]);

  // Fix #22: Email validation
  const validateEmail = (email: string) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email) {
      setEmailError('Email is required');
      return false;
    }
    if (!re.test(email)) {
      setEmailError('Invalid email format');
      return false;
    }
    setEmailError('');
    return true;
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateProviderSettings({ profile, notifications }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider', 'settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const handleSave = () => {
    if (!validateEmail(profile.email)) return;
    saveMutation.mutate();
  };

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
        <p className="text-sm text-hcx-text-muted">Manage your profile and notification preferences</p>
      </header>

      {/* Fix #22: Success feedback */}
      {saved && (
        <Alert variant="success">
          <CheckCircle2 className="size-4" />
          <AlertTitle>Settings Saved</AlertTitle>
          <AlertDescription>Your profile and notification preferences have been updated successfully.</AlertDescription>
        </Alert>
      )}

      {/* Fix #22: Profile editing with validation */}
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
              onChange={(e) => {
                setProfile({ ...profile, email: e.target.value });
                if (emailError) validateEmail(e.target.value);
              }}
              className={emailError ? 'border-hcx-danger' : ''}
            />
            {emailError && (
              <p className="text-xs text-hcx-danger">{emailError}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              dir="ltr"
              value={profile.phone}
              onChange={(e) =>
                setProfile({ ...profile, phone: e.target.value })
              }
              placeholder="+20 xxx xxx xxxx"
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

      {/* Fix #21: Enhanced notification preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="size-5 text-hcx-primary" aria-hidden />
            {t('notifications')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Delivery channels */}
          <div className="rounded-lg border border-border p-3">
            <p className="text-sm font-semibold mb-2">Delivery Channels</p>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifications.emailAlerts}
                  onChange={(e) =>
                    setNotifications({ ...notifications, emailAlerts: e.target.checked })
                  }
                  className="size-4"
                />
                <span className="text-sm">Email Alerts</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifications.inAppAlerts}
                  onChange={(e) =>
                    setNotifications({ ...notifications, inAppAlerts: e.target.checked })
                  }
                  className="size-4"
                />
                <span className="text-sm">In-App Notifications</span>
              </label>
            </div>
          </div>

          {/* Individual notification types */}
          <NotificationToggle
            label={t('notifyDenial')}
            description="Get notified when a claim is denied"
            checked={notifications.denial}
            onChange={(v) => setNotifications({ ...notifications, denial: v })}
          />
          <NotificationToggle
            label={t('notifyPayment')}
            description="Get notified when a payment is settled"
            checked={notifications.payment}
            onChange={(v) => setNotifications({ ...notifications, payment: v })}
          />
          <NotificationToggle
            label="Pre-authorization Updates"
            description="Get notified when a pre-auth request status changes"
            checked={notifications.preauth}
            onChange={(v) => setNotifications({ ...notifications, preauth: v })}
          />
          <NotificationToggle
            label={t('notifyComms')}
            description="Receive messages from payers and regulators"
            checked={notifications.comms}
            onChange={(v) => setNotifications({ ...notifications, comms: v })}
          />
        </CardContent>
      </Card>

      {/* Security section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="size-5 text-hcx-primary" aria-hidden />
            Security
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-hcx-text-muted mb-3">
            Your account is managed through the central authentication system. To change your password, use the Keycloak account management portal.
          </p>
          <Button variant="outline" size="sm" asChild>
            <a
              href="https://auth.claim.healthflow.tech/realms/hcx/account"
              target="_blank"
              rel="noopener noreferrer"
            >
              Manage Account Security
            </a>
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
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

function NotificationToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border p-3 hover:bg-accent/30 transition-colors">
      <div>
        <span className="text-sm font-medium">{label}</span>
        <p className="text-xs text-hcx-text-muted">{description}</p>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4"
      />
    </label>
  );
}
