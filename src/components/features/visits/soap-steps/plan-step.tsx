'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { INTERVENTION_OPTIONS } from '@/lib/constants/soap-options';
import type { SoapPlan } from '@/types/structured-soap';

interface PlanStepProps {
  data: SoapPlan;
  onChange: (data: SoapPlan) => void;
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

function OptionalTextarea({
  id,
  label,
  value,
  placeholder,
  rows,
  onChange,
}: {
  id: string;
  label: string;
  value: string | undefined;
  placeholder: string;
  rows?: number;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <textarea
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder={placeholder}
        rows={rows ?? 3}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
      />
    </div>
  );
}

export function PlanStep({ data, onChange }: PlanStepProps) {
  const [showFreeText, setShowFreeText] = useState(!!data.free_text);

  const hasPrescriptionProposal = data.intervention_checks.includes('prescription_proposal');

  function toggleIntervention(value: string) {
    const current = data.intervention_checks;
    const isSelected = current.includes(value);

    let next: string[];
    if (isSelected) {
      next = current.filter((v) => v !== value);
    } else {
      next = [...current, value];
    }

    // 処方提案チェックを外したらテキストもクリア
    const updates: Partial<SoapPlan> = { intervention_checks: next };
    if (value === 'prescription_proposal' && isSelected) {
      updates.prescription_proposal = undefined;
    }

    onChange({ ...data, ...updates });
  }

  return (
    <div className="space-y-6">
      {/* Intervention Checks */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">介入内容</h3>
        <div className="grid grid-cols-2 gap-2">
          {INTERVENTION_OPTIONS.map((opt) => (
            <ToggleButton
              key={opt.value}
              label={opt.label}
              selected={data.intervention_checks.includes(opt.value)}
              onToggle={() => toggleIntervention(opt.value)}
            />
          ))}
        </div>
      </div>

      {/* Next Visit Date */}
      <div className="space-y-1">
        <Label htmlFor="next-visit-date" className="text-sm font-semibold text-foreground">
          次回訪問予定日
        </Label>
        <Input
          id="next-visit-date"
          type="date"
          value={data.next_visit_date ?? ''}
          onChange={(e) =>
            onChange({ ...data, next_visit_date: e.target.value || undefined })
          }
          className="h-10 text-sm"
        />
      </div>

      {/* Prescription Proposal (shown only when checked) */}
      {hasPrescriptionProposal && (
        <OptionalTextarea
          id="prescription-proposal"
          label="処方提案の内容"
          value={data.prescription_proposal}
          placeholder="処方変更の提案内容を記述してください"
          onChange={(v) => onChange({ ...data, prescription_proposal: v })}
        />
      )}

      {/* Physician Report */}
      <OptionalTextarea
        id="physician-report"
        label="医師連絡事項"
        value={data.physician_report_items}
        placeholder="医師への連絡・報告事項を記述してください"
        onChange={(v) => onChange({ ...data, physician_report_items: v })}
      />

      {/* Care Manager Report */}
      <OptionalTextarea
        id="care-manager-report"
        label="ケアマネ連絡事項"
        value={data.care_manager_report_items}
        placeholder="ケアマネージャーへの連絡事項を記述してください"
        onChange={(v) => onChange({ ...data, care_manager_report_items: v })}
      />

      {/* Care Service Coordination */}
      <OptionalTextarea
        id="care-service"
        label="介護サービス連携"
        value={data.care_service_coordination}
        placeholder="介護サービス事業者との連携内容を記述してください"
        onChange={(v) => onChange({ ...data, care_service_coordination: v })}
      />

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
              placeholder="計画の詳細を自由に記述してください"
              rows={4}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}
