'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * SRS §FR-PP-ICD-001 — searchable Arabic/English ICD-10 autocomplete.
 *
 * First-iteration implementation uses a bundled static index of the
 * most-common Egyptian ICD-10 codes (derived from the fixture set
 * used by scripts/generate_test_claims.py). Real rollout replaces the
 * static index with a debounced fetch to the backend:
 *
 *     GET /internal/ai/bff/icd10/search?q=...
 *
 * which proxies to Spark NLP entity resolution over the full WHO
 * ICD-10 + EDA extension code set.
 */
interface Icd10Entry {
  code: string;
  en: string;
  ar: string;
}

// Seed from scripts/generate_test_claims.py EGYPTIAN_ICD10_COMMON. Keep
// in sync with the backend test fixtures until the BFF search endpoint
// exists. ~12 codes cover the bulk of outpatient volume.
const SEED: Icd10Entry[] = [
  { code: 'J06.9', en: 'Acute upper respiratory infection', ar: 'التهاب الجهاز التنفسي العلوي الحاد' },
  { code: 'E11.9', en: 'Type 2 diabetes mellitus', ar: 'داء السكري من النوع الثاني' },
  { code: 'I10',   en: 'Essential hypertension', ar: 'ارتفاع ضغط الدم الأساسي' },
  { code: 'K21.0', en: 'Gastroesophageal reflux with oesophagitis', ar: 'ارتجاع المريء مع التهاب المريء' },
  { code: 'M54.5', en: 'Low back pain', ar: 'ألم أسفل الظهر' },
  { code: 'F41.1', en: 'Generalized anxiety disorder', ar: 'اضطراب القلق العام' },
  { code: 'J18.9', en: 'Pneumonia, unspecified', ar: 'التهاب رئوي غير محدد' },
  { code: 'N39.0', en: 'Urinary tract infection', ar: 'التهاب المسالك البولية' },
  { code: 'L50.0', en: 'Allergic urticaria', ar: 'الشرى التحسسي' },
  { code: 'H10.3', en: 'Acute conjunctivitis', ar: 'التهاب الملتحمة الحاد' },
  { code: 'G43.9', en: 'Migraine', ar: 'الصداع النصفي' },
  { code: 'B34.9', en: 'Viral infection, unspecified', ar: 'عدوى فيروسية غير محددة' },
  { code: 'Z00.00', en: 'General adult medical examination', ar: 'فحص طبي عام' },
  { code: 'A00.0',  en: 'Cholera', ar: 'الكوليرا' },
];

export interface Icd10SelectorProps {
  value: string;
  onChange: (code: string) => void;
  className?: string;
  id?: string;
  placeholder?: string;
}

export function Icd10Selector({
  value,
  onChange,
  className,
  id,
  placeholder,
}: Icd10SelectorProps) {
  const t = useTranslations('provider.newClaim');
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SEED.slice(0, 5);
    return SEED.filter(
      (e) =>
        e.code.toLowerCase().includes(q) ||
        e.en.toLowerCase().includes(q) ||
        e.ar.includes(query),
    ).slice(0, 8);
  }, [query]);

  const handleSelect = (entry: Icd10Entry) => {
    setQuery(entry.code);
    onChange(entry.code);
    setOpen(false);
  };

  const clear = () => {
    setQuery('');
    onChange('');
  };

  return (
    <div ref={ref} className={cn('relative', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-hcx-text-muted" />
        <Input
          id={id}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            onChange(e.target.value);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder ?? t('searchDiagnosis')}
          className="ps-9 pe-9 font-mono"
          autoComplete="off"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {query && (
          <button
            type="button"
            onClick={clear}
            className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-hcx-text-muted hover:bg-muted"
            aria-label="Clear"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {open && matches.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-card shadow-lg"
        >
          {matches.map((entry) => (
            <li
              key={entry.code}
              role="option"
              aria-selected={entry.code === value}
              className="cursor-pointer px-3 py-2 text-sm hover:bg-accent/60 focus:bg-accent/60"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(entry);
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-semibold">{entry.code}</span>
                <span className="text-xs text-hcx-text-muted">{entry.en}</span>
              </div>
              <div className="text-xs text-hcx-text-muted">{entry.ar}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
