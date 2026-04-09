import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ShieldOff } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * SRS §9.3 — AccessDenied page shown when the BFF returns 403.
 * Arabic-friendly layout with a "back to portal selector" link.
 */
export default async function AccessDeniedPage() {
  const t = await getTranslations('common');
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-hcx-primary-light/40 to-background p-6">
      <Card className="max-w-lg border-hcx-danger/40">
        <CardHeader className="flex flex-row items-center gap-3">
          <div className="rounded-lg bg-hcx-danger/10 p-3 text-hcx-danger">
            <ShieldOff className="size-6" aria-hidden />
          </div>
          <div>
            <CardTitle>{t('accessDenied')}</CardTitle>
            <CardDescription>{t('unauthorized')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-hcx-text-muted">
            Your account does not have the permissions required to access
            this portal. Contact your HCX administrator if you believe this
            is a mistake.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-md bg-hcx-primary px-4 py-2 text-sm font-semibold text-white hover:bg-hcx-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hcx-primary focus-visible:ring-offset-2"
          >
            {t('back')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
