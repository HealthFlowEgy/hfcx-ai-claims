'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Next.js global error boundary (SRS §9.3).
 * Any unhandled error in the app tree lands here. We log it once,
 * show the user a retry button, and avoid leaking stack traces.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('HFCX UI error boundary caught:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="max-w-lg border-hcx-danger/40">
        <CardHeader className="flex flex-row items-center gap-3">
          <div className="rounded-lg bg-hcx-danger/10 p-3 text-hcx-danger">
            <AlertTriangle className="size-6" aria-hidden />
          </div>
          <div>
            <CardTitle>{t('error')}</CardTitle>
            <CardDescription>
              {error.digest ? `ref: ${error.digest}` : ''}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button onClick={() => reset()}>{t('retry')}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
