'use client';

import * as React from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Report generation UI shell (SRS §5.4.3).
 *
 * Displays a card with report metadata, a "Generate Report" button
 * with a loading spinner, and a download link once a report URL is
 * available.  Actual PDF generation is deferred to a backend service
 * — this component only drives the UI state.
 */

export interface ReportGeneratorProps {
  title: string;
  data: Record<string, unknown>;
  onGenerate: () => void;
  isGenerating: boolean;
  /** Optional URL to a generated report ready for download. */
  downloadUrl?: string;
  className?: string;
}

export function ReportGenerator({
  title,
  data,
  onGenerate,
  isGenerating,
  downloadUrl,
  className,
}: ReportGeneratorProps) {
  const entryCount = Object.keys(data).length;

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-hcx-primary-light/60 p-2 text-hcx-primary">
            <FileText className="size-5" aria-hidden />
          </div>
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-2">
        <p className="text-sm text-hcx-text-muted">
          Report contains{' '}
          <span className="font-semibold text-hcx-text">
            {entryCount}
          </span>{' '}
          data {entryCount === 1 ? 'field' : 'fields'}.
        </p>

        {/* Preview first few keys */}
        <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-hcx-text-muted">
          {Object.keys(data)
            .slice(0, 6)
            .map((key) => (
              <li key={key} className="flex items-center gap-1.5">
                <span className="inline-block size-1.5 shrink-0 rounded-full bg-hcx-primary" />
                <span className="truncate">{key}</span>
              </li>
            ))}
          {entryCount > 6 && (
            <li className="text-hcx-text-muted">
              + {entryCount - 6} more...
            </li>
          )}
        </ul>
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2">
        <Button
          onClick={onGenerate}
          disabled={isGenerating}
          className="gap-2"
        >
          {isGenerating ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Generating...
            </>
          ) : (
            'Generate Report'
          )}
        </Button>

        {downloadUrl && !isGenerating && (
          <Button variant="outline" className="gap-2" asChild>
            <a href={downloadUrl} download>
              <Download className="size-4" aria-hidden />
              Download
            </a>
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
