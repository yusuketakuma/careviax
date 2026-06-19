'use client';

import { useState, useRef, useEffect, useCallback, useMemo, useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pill, AlertTriangle, Shield } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import {
  fetchDrugMasterSuggestions,
  type DrugMasterSuggestion,
} from '@/lib/pharmacy/drug-master-suggestions';

const DRUG_SUGGEST_DEBOUNCE_MS = 250;

export type DrugSelection = {
  drug_name: string;
  drug_code: string;
  dosage_form: string | null;
  unit: string | null;
  is_generic: boolean;
  is_narcotic: boolean;
  is_psychotropic: boolean;
  max_administration_days: number | null;
  drug_price: number | null;
};

interface DrugSuggestProps {
  value: string;
  onTextChange: (text: string) => void;
  onSelect: (drug: DrugSelection) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
  inputId?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
}

export function DrugSuggest({
  value,
  onTextChange,
  onSelect,
  placeholder = '薬剤名を入力（マスター検索）',
  required = false,
  className = '',
  inputId,
  ariaLabel,
  ariaDescribedBy,
}: DrugSuggestProps) {
  const orgId = useOrgId();
  const generatedId = useId();
  const [open, setOpen] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const normalizedValue = value.trim();
  const debouncedQuery = useDebouncedValue(normalizedValue, DRUG_SUGGEST_DEBOUNCE_MS);
  const resolvedInputId = inputId ?? `drug-suggest-${generatedId}`;
  const listboxId = `${resolvedInputId}-listbox`;

  const { data } = useQuery({
    queryKey: ['drug-suggest', orgId, debouncedQuery],
    queryFn: async () => {
      return fetchDrugMasterSuggestions({ query: debouncedQuery, orgId });
    },
    enabled: !!orgId && debouncedQuery.length >= 2,
    staleTime: 30_000,
  });

  const suggestions = useMemo(() => data ?? [], [data]);
  const activeOptionId =
    open && focusedIdx >= 0 && suggestions[focusedIdx]
      ? `${listboxId}-option-${suggestions[focusedIdx].id}`
      : undefined;

  const handleSelect = useCallback(
    (drug: DrugMasterSuggestion) => {
      onSelect({
        drug_name: drug.drug_name,
        drug_code: drug.yj_code,
        dosage_form: drug.dosage_form,
        unit: drug.unit,
        is_generic: drug.is_generic,
        is_narcotic: drug.is_narcotic,
        is_psychotropic: drug.is_psychotropic,
        max_administration_days: drug.max_administration_days,
        drug_price: drug.drug_price,
      });
      onTextChange(drug.drug_name);
      setOpen(false);
      setFocusedIdx(-1);
    },
    [onSelect, onTextChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open || suggestions.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIdx((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && focusedIdx >= 0) {
        e.preventDefault();
        handleSelect(suggestions[focusedIdx]);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    },
    [open, suggestions, focusedIdx, handleSelect],
  );

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(e.target as Node) &&
        listRef.current &&
        !listRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative">
      <input
        id={resolvedInputId}
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onTextChange(e.target.value);
          setOpen(true);
          setFocusedIdx(-1);
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        required={required}
        className={`min-h-[44px] w-full rounded-md border border-input bg-background px-2 text-sm sm:h-8 sm:min-h-0 ${className}`}
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-autocomplete="list"
        aria-controls={suggestions.length > 0 ? listboxId : undefined}
        aria-activedescendant={activeOptionId}
        aria-label={ariaLabel ?? placeholder}
        aria-describedby={ariaDescribedBy}
      />

      {open && suggestions.length > 0 && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover shadow-lg"
        >
          {suggestions.map((drug, idx) => (
            <li
              key={drug.id}
              id={`${listboxId}-option-${drug.id}`}
              role="option"
              aria-selected={idx === focusedIdx}
              className={[
                'cursor-pointer px-3 py-2 text-sm hover:bg-accent',
                idx === focusedIdx ? 'bg-accent' : '',
              ].join(' ')}
              onClick={() => handleSelect(drug)}
              onMouseEnter={() => setFocusedIdx(idx)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Pill className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="font-medium text-foreground">{drug.drug_name}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {drug.dosage_form && <span>[{drug.dosage_form}]</span>}
                    <span className="tabular-nums">{drug.yj_code}</span>
                    {drug.manufacturer && <span>{drug.manufacturer}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  {drug.drug_price != null && (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      ¥{Number(drug.drug_price).toFixed(1)}/{drug.unit ?? '単位'}
                    </span>
                  )}
                  <div className="flex gap-1">
                    {drug.is_generic && (
                      <Badge
                        variant="outline"
                        className="h-4 border-transparent bg-tag-info/10 px-1 text-[9px] text-tag-info"
                      >
                        後発
                      </Badge>
                    )}
                    {drug.is_narcotic && (
                      <span className="flex items-center gap-0.5 text-[9px] font-medium text-tag-hazard">
                        <AlertTriangle className="size-2.5" aria-hidden="true" />
                        麻薬
                      </span>
                    )}
                    {drug.is_psychotropic && (
                      <span className="flex items-center gap-0.5 text-[9px] font-medium text-tag-hazard">
                        <Shield className="size-2.5" aria-hidden="true" />
                        向精神
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
