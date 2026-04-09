import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { MapPinOff } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default async function NotFound() {
  const t = await getTranslations('common');
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-hcx-primary-light/40 to-background p-6">
      <Card className="max-w-lg">
        <CardHeader className="flex flex-row items-center gap-3">
          <div className="rounded-lg bg-hcx-muted/10 p-3 text-hcx-muted">
            <MapPinOff className="size-6" aria-hidden />
          </div>
          <div>
            <CardTitle>404</CardTitle>
            <CardDescription>{t('noData')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-md bg-hcx-primary px-4 py-2 text-sm font-semibold text-white hover:bg-hcx-primary/90"
          >
            {t('back')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
