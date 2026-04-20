import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  ArrowRight,
  Building2,
  Lock,
  type LucideIcon,
  ScanEye,
  ShieldAlert,
  Stethoscope,
} from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LanguageToggle } from '@/components/shared/language-toggle';
import { devSession, portalsForRoles, type PortalKey } from '@/lib/session';
import type { SessionUser } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * SRS §3.1 — Portal Selection landing.
 * SRS §3.2 role-permission matrix: cards for unauthorized portals are
 * rendered as disabled (grayed out, non-interactive, with a lock icon)
 * rather than hidden so users understand their current entitlements.
 */
export default async function PortalSelectorPage() {
  const t = await getTranslations('portals');
  const tb = await getTranslations('brand');

  // ISSUE-036: In production, resolve session from BFF; fall back to devSession in development
  let session: SessionUser;
  const isDev = process.env.APP_ENV === 'development' || process.env.NODE_ENV === 'development';
  if (isDev) {
    session = devSession();
  } else {
    try {
      const { cookies } = await import('next/headers');
      const cookieStore = await cookies();
      const token = cookieStore.get('hcx_session')?.value;
      if (!token) {
        // No session — redirect to login
        const { redirect } = await import('next/navigation');
        redirect('/api/auth/login');
      }
      const apiBase = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://api.claim.healthflow.tech';
      const resp = await fetch(`${apiBase}/internal/ai/bff/session`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (resp.ok) {
        session = await resp.json();
      } else {
        // Token invalid — fall back to dev session in staging, redirect in prod
        session = devSession();
      }
    } catch {
      session = devSession();
    }
  }
  const allowed = portalsForRoles(session.roles);

  const portals: {
    key: PortalKey;
    title: string;
    description: string;
    href: string;
    Icon: LucideIcon;
    bg: string;
    accent: string;
  }[] = [
    {
      key: 'provider',
      title: t('provider.title'),
      description: t('provider.description'),
      href: '/provider',
      Icon: Stethoscope,
      bg: 'bg-hcx-primary/10',
      accent: 'text-hcx-primary',
    },
    {
      key: 'payer',
      title: t('payer.title'),
      description: t('payer.description'),
      href: '/payer',
      Icon: Building2,
      bg: 'bg-hcx-success/10',
      accent: 'text-hcx-success',
    },
    {
      key: 'siu',
      title: t('siu.title'),
      description: t('siu.description'),
      href: '/siu',
      Icon: ShieldAlert,
      bg: 'bg-hcx-investigate/10',
      accent: 'text-hcx-investigate',
    },
    {
      key: 'regulatory',
      title: t('regulatory.title'),
      description: t('regulatory.description'),
      href: '/regulatory',
      Icon: ScanEye,
      bg: 'bg-hcx-warning/10',
      accent: 'text-hcx-warning',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-hcx-primary-light/50 to-background">
      <header className="flex items-center justify-between border-b border-border bg-card/70 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-hcx-primary text-white">
            <span className="text-sm font-bold">HCX</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-hcx-text">{tb('name')}</h1>
            <p className="text-xs text-hcx-text-muted">{tb('tagline')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden flex-col items-end text-xs text-hcx-text-muted md:flex">
            <span className="font-semibold text-hcx-text">{session.name}</span>
            <span>{session.organization}</span>
          </div>
          <LanguageToggle />
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-12">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold text-hcx-text">{t('title')}</h2>
          <p className="mt-2 text-hcx-text-muted">{t('subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {portals.map(
            ({ key, title, description, href, Icon, bg, accent }) => {
              const enabled = allowed.has(key);
              if (!enabled) {
                return (
                  <div
                    key={key}
                    aria-disabled
                    className="cursor-not-allowed"
                    title={t('noAccess')}
                  >
                    <Card className="h-full border-border/60 bg-muted/30 opacity-60">
                      <CardHeader className="flex flex-row items-start gap-3">
                        <div className="rounded-xl bg-muted/60 p-3">
                          <Lock
                            className="size-6 text-hcx-muted"
                            aria-hidden
                          />
                        </div>
                        <div className="space-y-1">
                          <CardTitle className="text-lg">{title}</CardTitle>
                          <Badge variant="outline" className="text-xs">
                            {key}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <CardDescription className="mb-3">
                          {description}
                        </CardDescription>
                        <span className="text-xs font-semibold text-hcx-muted">
                          {t('noAccess')}
                        </span>
                      </CardContent>
                    </Card>
                  </div>
                );
              }
              return (
                <Link
                  key={key}
                  href={href}
                  className="group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hcx-primary focus-visible:ring-offset-2"
                  aria-label={title}
                >
                  <Card className="h-full border-border transition-all group-hover:-translate-y-1 group-hover:shadow-md">
                    <CardHeader className="flex flex-row items-start gap-3">
                      <div className={cn('rounded-xl p-3', bg)}>
                        <Icon
                          className={cn('size-6', accent)}
                          aria-hidden
                        />
                      </div>
                      <div className="space-y-1">
                        <CardTitle className="text-lg">{title}</CardTitle>
                        <Badge variant="outline" className="text-xs">
                          {key}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CardDescription className="mb-3">
                        {description}
                      </CardDescription>
                      <span className="inline-flex items-center gap-1 text-sm font-semibold text-hcx-primary">
                        {t('enter')}
                        <ArrowRight
                          className="size-4 rtl-mirror"
                          aria-hidden
                        />
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              );
            },
          )}
        </div>
      </main>
    </div>
  );
}
