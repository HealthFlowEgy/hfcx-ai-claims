'use client';

import * as React from 'react';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Vertical claim-processing timeline (SRS §DS-AI-003).
 *
 * Visualises the stages a claim passes through. Supports RTL layout
 * via Tailwind logical properties that respect the inherited `dir`.
 */

export interface TimelineEvent {
  stage: string;
  timestamp: string;
  status: 'completed' | 'active' | 'pending';
  detail?: string;
}

export interface ClaimTimelineProps {
  events: TimelineEvent[];
  className?: string;
}

function DotIcon({ status }: { status: TimelineEvent['status'] }) {
  if (status === 'completed') {
    return (
      <span className="flex size-6 items-center justify-center rounded-full bg-hcx-success text-white">
        <Check className="size-3.5" aria-hidden />
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="relative flex size-6 items-center justify-center">
        <span className="absolute inline-flex size-6 animate-ping rounded-full bg-hcx-primary opacity-30" />
        <span className="relative inline-flex size-4 rounded-full bg-hcx-primary" />
      </span>
    );
  }
  // pending
  return <span className="flex size-6 items-center justify-center rounded-full border-2 border-muted bg-background" />;
}

export function ClaimTimeline({ events, className }: ClaimTimelineProps) {
  if (!events.length) return null;

  return (
    <ol
      className={cn('relative space-y-6', className)}
      aria-label="Claim processing timeline"
    >
      {events.map((evt, idx) => {
        const isLast = idx === events.length - 1;

        return (
          {/* ISSUE-069: Use stable key with timestamp instead of index */}
          <li key={`${evt.stage}-${evt.timestamp}`} className="flex gap-4">
            {/* Dot + connecting line */}
            <div className="relative flex flex-col items-center">
              <DotIcon status={evt.status} />
              {!isLast && (
                <span
                  className={cn(
                    'absolute top-7 w-0.5 flex-1',
                    evt.status === 'completed'
                      ? 'bg-hcx-success'
                      : 'bg-muted',
                  )}
                  style={{ bottom: '-1.5rem' }}
                  aria-hidden
                />
              )}
            </div>

            {/* Label + detail */}
            <div className="min-w-0 flex-1 pb-1">
              <p
                className={cn(
                  'text-sm font-semibold leading-6',
                  evt.status === 'active' && 'text-hcx-primary',
                  evt.status === 'pending' && 'text-hcx-text-muted',
                  evt.status === 'completed' && 'text-hcx-text',
                )}
              >
                {evt.stage}
              </p>
              {evt.detail && (
                <p className="mt-0.5 text-xs text-hcx-text-muted">
                  {evt.detail}
                </p>
              )}
              <time
                className="mt-0.5 block text-xs text-hcx-text-muted"
                dateTime={evt.timestamp}
              >
                {new Date(evt.timestamp).toLocaleString()}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
