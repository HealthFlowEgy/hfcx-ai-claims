'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Search, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * SRS §FR-PP-ICD-001 — Searchable ICD-10 / CPT autocomplete.
 *
 * Fetches results from the backend code search endpoint:
 *   GET /internal/ai/bff/codes/search?q=...&type=icd10|cpt&limit=15
 *
 * Features:
 *   - Debounced search (300ms) to avoid excessive API calls
 *   - Supports both ICD-10-CM (74,719 codes) and CPT (8,222 codes)
 *   - Shows code + description in dropdown
 *   - Keyboard navigation (arrow keys + enter)
 */

interface CodeEntry {
  code: string;
  description: string;
}

export interface CodeSelectorProps {
  value: string;
  onChange: (code: string) => void;
  codeType: 'icd10' | 'cpt';
  className?: string;
  id?: string;
  placeholder?: string;
}

export function CodeSelector({
  value,
  onChange,
  codeType,
  className,
  id,
  placeholder,
}: CodeSelectorProps) {
  const t = useTranslations('provider.newClaim');
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<CodeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [selectedDesc, setSelectedDesc] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const fetchResults = useCallback(
    async (q: string) => {
      // Cancel any in-flight request
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      try {
        const params = new URLSearchParams({
          q,
          type: codeType,
          limit: '15',
        });
        const resp = await fetch(
          `/api/proxy/internal/ai/bff/codes/search?${params}`,
          { signal: controller.signal },
        );
        if (!resp.ok) throw new Error('Search failed');
        const data = await resp.json();
        setResults(data.results ?? []);
        setHighlightIndex(-1);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setResults([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [codeType],
  );

  const handleInputChange = (val: string) => {
    setQuery(val);
    onChange(val);
    setSelectedDesc('');
    setOpen(true);

    // Debounce the search
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      fetchResults(val);
    }, 300);
  };

  const handleSelect = (entry: CodeEntry) => {
    setQuery(entry.code);
    setSelectedDesc(entry.description);
    onChange(entry.code);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((prev) =>
        prev < results.length - 1 ? prev + 1 : 0,
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((prev) =>
        prev > 0 ? prev - 1 : results.length - 1,
      );
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault();
      handleSelect(results[highlightIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const clear = () => {
    setQuery('');
    setSelectedDesc('');
    onChange('');
    setResults([]);
  };

  const defaultPlaceholder =
    codeType === 'icd10'
      ? (placeholder ?? t('searchDiagnosis'))
      : (placeholder ?? 'Search CPT code or procedure...');

  return (
    <div ref={ref} className={cn('relative', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-hcx-text-muted" />
        <Input
          id={id}
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => {
            setOpen(true);
            if (!results.length) fetchResults(query);
          }}
          onKeyDown={handleKeyDown}
          placeholder={defaultPlaceholder}
          className="ps-9 pe-9 font-mono"
          autoComplete="off"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {loading && (
          <Loader2 className="absolute end-8 top-1/2 size-4 -translate-y-1/2 animate-spin text-hcx-text-muted" />
        )}
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
      {/* Show selected description below the input */}
      {selectedDesc && !open && (
        <p className="mt-1 truncate text-xs text-hcx-text-muted">
          {selectedDesc}
        </p>
      )}
      {open && results.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-card shadow-lg"
        >
          {results.map((entry, idx) => (
            <li
              key={`${entry.code}-${idx}`}
              role="option"
              aria-selected={entry.code === value}
              className={cn(
                'cursor-pointer px-3 py-2 text-sm hover:bg-accent/60',
                idx === highlightIndex && 'bg-accent/60',
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(entry);
              }}
              onMouseEnter={() => setHighlightIndex(idx)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="shrink-0 font-mono font-semibold">
                  {entry.code}
                </span>
                <span className="truncate text-xs text-hcx-text-muted">
                  {entry.description}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && results.length === 0 && query.length > 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-hcx-text-muted shadow-lg">
          No matching codes found
        </div>
      )}
    </div>
  );
}
