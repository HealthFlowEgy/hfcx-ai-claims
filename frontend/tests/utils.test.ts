import { describe, expect, it } from 'vitest';

import {
  clamp,
  cn,
  formatDate,
  formatEgp,
  maskNationalId,
  toArabicDigits,
} from '@/lib/utils';

describe('utils', () => {
  it('cn merges tailwind classes', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-red-500', undefined, 'font-bold')).toBe('text-red-500 font-bold');
  });

  it('toArabicDigits converts Western to Arabic-Indic', () => {
    expect(toArabicDigits('123')).toBe('١٢٣');
    expect(toArabicDigits(2026)).toBe('٢٠٢٦');
    expect(toArabicDigits('J06.9')).toBe('J٠٦.٩'); // letters preserved
  });

  it('maskNationalId keeps the last four digits', () => {
    expect(maskNationalId('29901011234567')).toBe('**********4567');
    expect(maskNationalId('')).toBe('');
    expect(maskNationalId('12')).toBe('**');
  });

  it('formatEgp renders currency in both locales', () => {
    expect(formatEgp(1500.5, 'en')).toMatch(/EGP/);
    expect(formatEgp(1500.5, 'ar')).toMatch(/ج\.?م|EGP/);
  });

  it('formatDate uses DD/MM/YYYY ordering', () => {
    const iso = '2026-04-09T10:00:00Z';
    expect(formatDate(iso, 'en')).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    // Arabic uses Arabic-Indic digits
    const ar = formatDate(iso, 'ar');
    expect(ar).toMatch(/[٠-٩]{2}/);
  });

  it('clamp bounds values', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});
