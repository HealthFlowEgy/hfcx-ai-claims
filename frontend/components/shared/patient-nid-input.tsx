'use client';

import { forwardRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * 14-digit Egyptian National ID input with masked format validation.
 * Aligns with backend FR-EV-002 (validator accepts Western + Arabic-Indic).
 */
export interface PatientNidInputProps {
  value: string;
  onChange: (v: string) => void;
  onValidChange?: (valid: boolean) => void;
  className?: string;
  id?: string;
  label?: string;
}

const ARABIC_INDIC_TO_WESTERN: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

function normalize(input: string): string {
  return input
    .split('')
    .map((ch) => ARABIC_INDIC_TO_WESTERN[ch] ?? ch)
    .filter((ch) => /[0-9]/.test(ch))
    .join('')
    .slice(0, 14);
}

export const PatientNidInput = forwardRef<HTMLInputElement, PatientNidInputProps>(
  ({ value, onChange, onValidChange, className, id, label }, ref) => {
    const t = useTranslations('claim');

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const normalized = normalize(e.target.value);
        onChange(normalized);
        onValidChange?.(normalized.length === 14);
      },
      [onChange, onValidChange],
    );

    // ISSUE-030: Validate Egyptian NID structure (century digit 2 or 3)
    const isValid = value.length === 14 && /^[23]/.test(value);
    const inputId = id ?? 'patient-nid';

    return (
      <div className={cn('space-y-1.5', className)}>
        <Label htmlFor={inputId}>{label ?? t('patientNid')}</Label>
        <Input
          ref={ref}
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          dir="ltr"
          value={value}
          onChange={handleChange}
          placeholder="29901011234567"
          aria-invalid={value.length > 0 && !isValid}
          aria-required
          className={cn(
            'font-mono tabular-nums',
            value.length > 0 && !isValid && 'border-hcx-danger focus-visible:ring-hcx-danger',
            isValid && 'border-hcx-success',
          )}
        />
      </div>
    );
  },
);
PatientNidInput.displayName = 'PatientNidInput';
