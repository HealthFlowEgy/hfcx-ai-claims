import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind class names. Used by every shadcn-style component.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Convert Western-Arabic digits (0-9) into Eastern-Arabic (٠-٩).
 * Used when locale === 'ar' per SRS §DS-RTL-005.
 */
const WESTERN_TO_EASTERN: Record<string, string> = {
  '0': '٠',
  '1': '١',
  '2': '٢',
  '3': '٣',
  '4': '٤',
  '5': '٥',
  '6': '٦',
  '7': '٧',
  '8': '٨',
  '9': '٩',
};

export function toArabicDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => WESTERN_TO_EASTERN[d] ?? d);
}

export function maskNationalId(nid: string | null | undefined): string {
  if (!nid) return '';
  const s = String(nid);
  if (s.length <= 4) return '*'.repeat(s.length);
  return `${'*'.repeat(s.length - 4)}${s.slice(-4)}`;
}

/**
 * Format a claim amount as localized EGP.
 */
export function formatEgp(amount: number, locale: 'ar' | 'en'): string {
  const formatted = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 2,
  }).format(amount);
  return formatted;
}

/**
 * Format a Date/ISO-string as DD/MM/YYYY in the appropriate locale.
 */
export function formatDate(value: Date | string, locale: 'ar' | 'en'): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const iso = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
  return iso;
}

/**
 * Clamp a number to [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
