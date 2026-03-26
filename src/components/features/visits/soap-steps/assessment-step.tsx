'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { PROBLEM_CHECK_OPTIONS, SEVERITY_OPTIONS } from '@/lib/constants/soap-options';
import type { SoapAssessment } from '@/types/structured-soap';

interface AssessmentStepProps {
  data: SoapAssessment;
  onChange: (data: SoapAssessment) => void;
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

export function AssessmentStep({ data, onChange }: AssessmentStepProps) {
  const [showFreeText, setShowFreeText] = useState(!!data.free_text);

  const hasProblems =
    data.problem_checks.length > 0 && !data.problem_checks.includes('no_issues');

  function toggleProblem(value: string) {
    const current = data.problem_checks;

    if (value === 'no_issues') {
      // 「問題なし」選択時は他をリセット、重症度もクリア
      const isSelected = current.includes('no_issues');
      onChange({
        ...data,
        problem_checks: isSelected ? [] : ['no_issues'],
        severity: isSelected ? data.severity : undefined,
      });
      return;
    }

    // 他の問題を選択する場合は「問題なし」を外す
    const without_no_issues = current.filter((v) => v !== 'no_issues');
    const isSelected = without_no_issues.includes(value);
    onChange({
      ...data,
      problem_checks: isSelected
        ? without_no_issues.filter((v) => v !== value)
        : [...without_no_issues, value],
    });
  }

  return (
    <div className="space-y-6">
      {/* Problem Checks */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">薬学的問題チェック</h3>
        <div className="grid grid-cols-2 gap-2">
          {PROBLEM_CHECK_OPTIONS.map((opt) => (
            <ToggleButton
              key={opt.value}
              label={opt.label}
              selected={data.problem_checks.includes(opt.value)}
              onToggle={() => toggleProblem(opt.value)}
            />
          ))}
        </div>
      </div>

      {/* Severity (only shown when problems are selected) */}
      {hasProblems && (
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">重症度</h3>
          <div className="flex gap-2">
            {SEVERITY_OPTIONS.map((opt) => {
              const isSelected = data.severity === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    onChange({
                      ...data,
                      severity: data.severity === opt.value ? undefined : opt.value,
                    })
                  }
                  className={`h-12 flex-1 rounded-lg border text-sm font-medium transition-colors ${
                    isSelected
                      ? `${opt.color} border-transparent`
                      : 'border-input bg-background text-foreground hover:bg-accent'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Drug-related geriatric syndrome (optional text) */}
      {data.problem_checks.includes('drug_related_geriatric') && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">薬剤起因性老年症候群の詳細</h3>
          <textarea
            value={(data.drug_related_problems ?? []).join('\n')}
            onChange={(e) => {
              const lines = e.target.value
                ? e.target.value.split('\n').filter((l) => l.trim())
                : [];
              onChange({ ...data, drug_related_problems: lines });
            }}
            placeholder="疑われる薬剤や症候群を記述してください（1行1件）"
            rows={3}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>
      )}

      {/* Free text */}
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
              placeholder="評価の詳細を自由に記述してください"
              rows={4}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}
