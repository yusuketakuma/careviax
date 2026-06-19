'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  SLEEP_OPTIONS,
  COGNITION_OPTIONS,
  DIET_ORAL_OPTIONS,
  MOBILITY_OPTIONS,
  EXCRETION_OPTIONS,
  ADVERSE_EVENT_OPTIONS,
} from '@/lib/constants/soap-options';
import type {
  SoapObjective,
  FunctionalAssessment,
  ResidualMedicationEntry,
} from '@/types/structured-soap';
import { ToggleButton } from './toggle-button';

interface FunctionalAssessmentStepProps {
  data: SoapObjective;
  residualMedications: ResidualMedicationEntry[];
  onChange: (data: SoapObjective) => void;
  onResidualMedicationsChange: (entries: ResidualMedicationEntry[]) => void;
}

type AccordionCategory = 'sleep' | 'cognition' | 'diet_oral' | 'mobility' | 'excretion';

const CATEGORIES: {
  key: AccordionCategory;
  label: string;
  options: readonly { value: string; label: string }[];
}[] = [
  { key: 'sleep', label: '睡眠', options: SLEEP_OPTIONS },
  { key: 'cognition', label: '認知・感覚', options: COGNITION_OPTIONS },
  { key: 'diet_oral', label: '食事・口腔', options: DIET_ORAL_OPTIONS },
  { key: 'mobility', label: '歩行・運動', options: MOBILITY_OPTIONS },
  { key: 'excretion', label: '排泄', options: EXCRETION_OPTIONS },
];

function AccordionSection({
  categoryKey,
  label,
  options,
  selected,
  onToggle,
}: {
  categoryKey: AccordionCategory;
  label: string;
  options: readonly { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasSelection = selected.length > 0 && !selected.every((v) => v === 'no_issues');

  return (
    <div className="rounded-lg border border-input overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-accent"
        aria-expanded={open}
        aria-controls={`accordion-${categoryKey}`}
      >
        <span className="flex items-center gap-2">
          {label}
          {hasSelection && (
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {selected.filter((v) => v !== 'no_issues').length}件
            </span>
          )}
        </span>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div id={`accordion-${categoryKey}`} className="border-t border-input p-3">
          <div className="grid grid-cols-2 gap-2">
            {options.map((opt) => (
              <ToggleButton
                key={opt.value}
                label={opt.label}
                selected={selected.includes(opt.value)}
                onToggle={() => onToggle(opt.value)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function FunctionalAssessmentStep({
  data,
  residualMedications,
  onChange,
  onResidualMedicationsChange,
}: FunctionalAssessmentStepProps) {
  const [showResidual, setShowResidual] = useState(residualMedications.length > 0);

  const fa = data.functional_assessment ?? {
    sleep: [],
    cognition: [],
    diet_oral: [],
    mobility: [],
    excretion: [],
  };

  const adverseEvents = data.adverse_events ?? { has_events: false, events: [] };

  function updateFA(key: AccordionCategory, value: string) {
    const current = fa[key];

    let next: string[];
    if (value === 'no_issues') {
      // 「問題なし」は排他選択
      next = current.includes('no_issues') ? [] : ['no_issues'];
    } else {
      const without_no_issues = current.filter((v) => v !== 'no_issues');
      next = without_no_issues.includes(value)
        ? without_no_issues.filter((v) => v !== value)
        : [...without_no_issues, value];
    }

    const updatedFA: FunctionalAssessment = { ...fa, [key]: next };
    onChange({ ...data, functional_assessment: updatedFA });
  }

  function toggleAdverseEvent(value: string) {
    const current = adverseEvents.events;
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    onChange({ ...data, adverse_events: { ...adverseEvents, events: next } });
  }

  function addResidualEntry() {
    onResidualMedicationsChange([
      ...residualMedications,
      { drug_name: '', remaining_quantity: 0, excess_days: 0, is_reduction_target: false },
    ]);
  }

  function removeResidualEntry(index: number) {
    onResidualMedicationsChange(residualMedications.filter((_, i) => i !== index));
  }

  function updateResidualEntry(index: number, patch: Partial<ResidualMedicationEntry>) {
    onResidualMedicationsChange(
      residualMedications.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    );
  }

  return (
    <div className="space-y-6">
      {/* Functional Assessment Accordion */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">薬学的評価シート（機能評価）</h3>
        <div className="space-y-2">
          {CATEGORIES.map((cat) => (
            <AccordionSection
              key={cat.key}
              categoryKey={cat.key}
              label={cat.label}
              options={cat.options}
              selected={fa[cat.key]}
              onToggle={(value) => updateFA(cat.key, value)}
            />
          ))}
        </div>
      </div>

      {/* Adverse Events */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">薬物有害事象</h3>
        <div className="flex gap-2 mb-3">
          <button
            type="button"
            onClick={() =>
              onChange({
                ...data,
                adverse_events: { has_events: false, events: [], details: undefined },
              })
            }
            className={`h-14 flex-1 rounded-lg border text-sm font-medium transition-colors ${
              !adverseEvents.has_events
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-input bg-background text-foreground hover:bg-accent'
            }`}
          >
            なし
          </button>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...data,
                adverse_events: { ...adverseEvents, has_events: true },
              })
            }
            className={`h-14 flex-1 rounded-lg border text-sm font-medium transition-colors ${
              adverseEvents.has_events
                ? 'border-destructive bg-destructive/10 text-destructive'
                : 'border-input bg-background text-foreground hover:bg-accent'
            }`}
          >
            あり
          </button>
        </div>

        {adverseEvents.has_events && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {ADVERSE_EVENT_OPTIONS.map((opt) => (
                <ToggleButton
                  key={opt.value}
                  label={opt.label}
                  selected={adverseEvents.events.includes(opt.value)}
                  onToggle={() => toggleAdverseEvent(opt.value)}
                />
              ))}
            </div>
            <div className="space-y-1">
              <Label htmlFor="adverse-details" className="text-xs text-muted-foreground">
                有害事象の詳細
              </Label>
              <textarea
                id="adverse-details"
                value={adverseEvents.details ?? ''}
                onChange={(e) =>
                  onChange({
                    ...data,
                    adverse_events: {
                      ...adverseEvents,
                      details: e.target.value || undefined,
                    },
                  })
                }
                placeholder="有害事象の詳細を記述してください"
                rows={3}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* Residual Medications (collapsible, simple version) */}
      <div>
        <button
          type="button"
          onClick={() => {
            if (showResidual) {
              setShowResidual(false);
              onResidualMedicationsChange([]);
            } else {
              setShowResidual(true);
            }
          }}
          className="flex items-center gap-1 text-sm font-semibold text-foreground"
        >
          {showResidual ? (
            <ChevronUp className="size-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-4" aria-hidden="true" />
          )}
          残薬を記録する（任意）
        </button>

        {showResidual && (
          <div className="mt-3 space-y-3">
            {residualMedications.length === 0 && (
              <p className="py-2 text-sm text-muted-foreground text-center">
                薬剤を追加してください
              </p>
            )}

            {residualMedications.map((entry, index) => (
              <div key={index} className="rounded-lg border border-input p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    薬剤 {index + 1}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeResidualEntry(index)}
                    aria-label={`薬剤 ${index + 1} を削除`}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`residual-name-${index}`} className="text-xs">
                    薬剤名{' '}
                    <span className="text-destructive" aria-label="必須">
                      *
                    </span>
                  </Label>
                  <Input
                    id={`residual-name-${index}`}
                    type="text"
                    placeholder="例: アムロジピン錠5mg"
                    value={entry.drug_name}
                    onChange={(e) => updateResidualEntry(index, { drug_name: e.target.value })}
                    className="h-10 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`residual-qty-${index}`} className="text-xs">
                      残数
                    </Label>
                    <Input
                      id={`residual-qty-${index}`}
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      value={entry.remaining_quantity === 0 ? '' : entry.remaining_quantity}
                      onChange={(e) =>
                        updateResidualEntry(index, {
                          remaining_quantity: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="h-10 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`residual-days-${index}`} className="text-xs">
                      余剰日数
                    </Label>
                    <Input
                      id={`residual-days-${index}`}
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      value={entry.excess_days === 0 ? '' : entry.excess_days}
                      onChange={(e) =>
                        updateResidualEntry(index, {
                          excess_days: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="h-10 text-sm"
                    />
                  </div>
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addResidualEntry}
              className="w-full gap-1"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              薬剤を追加
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
