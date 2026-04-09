'use client';

import { useTranslations } from 'next-intl';
import { Construction } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Shared placeholder for screens that exist in the SRS navigation
 * but are tracked as follow-up items in the Appendix C rollout. Uses
 * a friendly "Under construction" card rather than Next.js's default
 * 404 page.
 */
export interface ComingSoonProps {
  title: string;
  description?: string;
  srsReference?: string;
}

export function ComingSoon({
  title,
  description,
  srsReference,
}: ComingSoonProps) {
  const t = useTranslations('common');
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <Card className="max-w-xl border-dashed">
        <CardHeader className="flex flex-row items-center gap-3">
          <div className="rounded-lg bg-hcx-warning/10 p-2 text-hcx-warning">
            <Construction className="size-6" aria-hidden />
          </div>
          <div>
            <CardTitle>{title}</CardTitle>
            {srsReference && (
              <p className="mt-1 text-xs text-hcx-text-muted">
                SRS reference: {srsReference}
              </p>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-hcx-text-muted">
            {description ??
              `${t('loading')} — this screen is tracked as a follow-up in the HCX rollout plan.`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
