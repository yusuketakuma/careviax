'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { SYMPTOM_OPTIONS } from '@/lib/constants/soap-options';
import type { SoapSubjective } from '@/types/structured-soap';

interface SubjectiveStepProps {
  data: SoapSubjective;
  onChange: (data: SoapSubjective) => void;
}

function ToggleButton({
  selected,
  label,
  onToggle,
}: {
  selected: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`min-h-[44px] rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
        selected
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-input bg-background text-foreground hover:bg-accent'
      }`}
    >
      {label}
    </button>
  );
}

export function SubjectiveStep({ data, onChange }: SubjectiveStepProps) {
  const [showFreeText, setShowFreeText] = useState(!!data.free_text);

  function toggleSymptom(value: string) {
    const current = data.symptom_checks;

    if (value === 'no_symptoms') {
      // 「自覚症状なし」選択時は他をリセット
      const isSelected = current.includes('no_symptoms');
      onChange({
        ...data,
        symptom_checks: isSelected ? [] : ['no_symptoms'],
      });
      return;
    }

    // 他の症状を選択する場合は「自覚症状なし」を外す
    const without_no_symptoms = current.filter((v) => v !== 'no_symptoms');
    const isSelected = without_no_symptoms.includes(value);
    onChange({
      ...data,
      symptom_checks: isSelected
        ? without_no_symptoms.filter((v) => v !== value)
        : [...without_no_symptoms, value],
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">症状チェック</h3>
        <div className="grid grid-cols-2 gap-2">
          {SYMPTOM_OPTIONS.map((opt) => (
            <ToggleButton
              key={opt.value}
              label={opt.label}
              selected={data.symptom_checks.includes(opt.value)}
              onToggle={() => toggleSymptom(opt.value)}
            />
          ))}
        </div>
      </div>

      <div>
        {!showFreeText ? (
          <button
            type="button"
            onClick={() => setShowFreeText(true)}
            className="flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <ChevronDown className="size-4" aria-hidden="true" />
            自由記述を追加
          </button>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                setShowFreeText(false);
                onChange({ ...data, free_text: undefined });
              }}
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <ChevronUp className="size-4" aria-hidden="true" />
              自由記述を閉じる
            </button>
            <textarea
              value={data.free_text ?? ''}
              onChange={(e) => onChange({ ...data, free_text: e.target.value || undefined })}
              placeholder="症状の詳細を自由に記述してください"
              rows={4}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}
