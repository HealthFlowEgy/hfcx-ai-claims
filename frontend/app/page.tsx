import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  Building2,
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
import { cn } from '@/lib/utils';

/**
 * SRS §3.1 — Portal Selection landing.
 * Shows all four portals. The role-based show/hide logic (SRS §3.2)
 * wraps these cards at the edge via the BFF role check; for the
 * scaffold we render all four with accessible keyboard navigation.
 */
export default function PortalSelectorPage() {
  const t = useTranslations('portals');
  const tb = useTranslations('brand');

  const portals = [
    {
      key: 'provider' as const,
      title: t('provider.title'),
      description: t('provider.description'),
      href: '/provider',
      Icon: Stethoscope,
      bg: 'bg-hcx-primary/10',
      accent: 'text-hcx-primary',
    },
    {
      key: 'payer' as const,
      title: t('payer.title'),
      description: t('payer.description'),
      href: '/payer',
      Icon: Building2,
      bg: 'bg-hcx-success/10',
      accent: 'text-hcx-success',
    },
    {
      key: 'siu' as const,
      title: t('siu.title'),
      description: t('siu.description'),
      href: '/siu',
      Icon: ShieldAlert,
      bg: 'bg-hcx-investigate/10',
      accent: 'text-hcx-investigate',
    },
    {
      key: 'regulatory' as const,
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
        <LanguageToggle />
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-12">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold text-hcx-text">{t('title')}</h2>
          <p className="mt-2 text-hcx-text-muted">{t('subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {portals.map(({ key, title, description, href, Icon, bg, accent }) => (
            <Link
              key={key}
              href={href}
              className="group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hcx-primary focus-visible:ring-offset-2"
              aria-label={title}
            >
              <Card className="h-full border-border transition-all group-hover:-translate-y-1 group-hover:shadow-md">
                <CardHeader className="flex flex-row items-start gap-3">
                  <div className={cn('rounded-xl p-3', bg)}>
                    <Icon className={cn('size-6', accent)} aria-hidden />
                  </div>
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{title}</CardTitle>
                    <Badge variant="outline" className="text-xs">
                      {key}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="mb-3">{description}</CardDescription>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-hcx-primary">
                    {t('enter')}
                    <ArrowRight className="size-4 rtl-mirror" aria-hidden />
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
