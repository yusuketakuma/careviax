'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  MEDICATION_STATUS_OPTIONS,
  ADHERENCE_LABELS,
  SELF_MANAGEMENT_OPTIONS,
} from '@/lib/constants/soap-options';
import type { SoapObjective, VitalSigns, LabValues } from '@/types/structured-soap';
import { ToggleButton } from './toggle-button';

interface ObjectiveBasicStepProps {
  data: SoapObjective;
  onChange: (data: SoapObjective) => void;
}

function VitalInput({
  id,
  label,
  value,
  unit,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: number | undefined;
  unit: string;
  placeholder: string;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-1">
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          placeholder={placeholder}
          value={value ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === '' ? undefined : parseFloat(raw));
          }}
          className="h-10 text-sm"
        />
        <span className="shrink-0 text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

export function ObjectiveBasicStep({ data, onChange }: ObjectiveBasicStepProps) {
  const [showLabValues, setShowLabValues] = useState(
    !!(data.lab_values && Object.values(data.lab_values).some((v) => v != null && v !== '')),
  );

  function updateVitals(patch: Partial<VitalSigns>) {
    onChange({ ...data, vitals: { ...data.vitals, ...patch } });
  }

  function updateLabValues(patch: Partial<LabValues>) {
    onChange({ ...data, lab_values: { ...data.lab_values, ...patch } });
  }

  const vitals = data.vitals ?? {};
  const labs = data.lab_values ?? {};

  return (
    <div className="space-y-6">
      {/* Vitals */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">バイタルサイン</h3>
        <div className="grid grid-cols-2 gap-3">
          {/* Blood pressure spans 2 columns */}
          <div className="col-span-2 space-y-1">
            <Label className="text-xs text-muted-foreground">血圧</Label>
            <div className="flex items-center gap-2">
              <Input
                type="text"
                inputMode="decimal"
                placeholder="上"
                value={vitals.systolic_bp ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  updateVitals({ systolic_bp: raw === '' ? undefined : parseFloat(raw) });
                }}
                className="h-10 text-sm"
                aria-label="収縮期血圧"
              />
              <span className="text-muted-foreground">/</span>
              <Input
                type="text"
                inputMode="decimal"
                placeholder="下"
                value={vitals.diastolic_bp ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  updateVitals({ diastolic_bp: raw === '' ? undefined : parseFloat(raw) });
                }}
                className="h-10 text-sm"
                aria-label="拡張期血圧"
              />
              <span className="shrink-0 text-xs text-muted-foreground">mmHg</span>
            </div>
          </div>

          <VitalInput
            id="pulse"
            label="脈拍"
            value={vitals.pulse}
            unit="/分"
            placeholder="例: 72"
            onChange={(v) => updateVitals({ pulse: v })}
          />
          <VitalInput
            id="temperature"
            label="体温"
            value={vitals.temperature}
            unit="℃"
            placeholder="例: 36.5"
            onChange={(v) => updateVitals({ temperature: v })}
          />
          <VitalInput
            id="spo2"
            label="SpO2"
            value={vitals.spo2}
            unit="%"
            placeholder="例: 98"
            onChange={(v) => updateVitals({ spo2: v })}
          />
          <VitalInput
            id="weight"
            label="体重"
            value={vitals.weight}
            unit="kg"
            placeholder="例: 58.0"
            onChange={(v) => updateVitals({ weight: v })}
          />
        </div>
      </div>

      {/* Lab Values (collapsible) */}
      <div>
        <button
          type="button"
          onClick={() => {
            if (showLabValues) {
              setShowLabValues(false);
              onChange({ ...data, lab_values: undefined });
            } else {
              setShowLabValues(true);
            }
          }}
          className="flex items-center gap-1 text-sm font-semibold text-foreground"
        >
          {showLabValues ? (
            <ChevronUp className="size-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-4" aria-hidden="true" />
          )}
          検査値（任意）
        </button>

        {showLabValues && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <VitalInput
              id="hba1c"
              label="HbA1c"
              value={labs.hba1c}
              unit="%"
              placeholder="例: 7.2"
              onChange={(v) => updateLabValues({ hba1c: v })}
            />
            <VitalInput
              id="egfr"
              label="eGFR"
              value={labs.egfr}
              unit=""
              placeholder="例: 55"
              onChange={(v) => updateLabValues({ egfr: v })}
            />
            <VitalInput
              id="k"
              label="K"
              value={labs.k}
              unit="mEq/L"
              placeholder="例: 4.0"
              onChange={(v) => updateLabValues({ k: v })}
            />
            <VitalInput
              id="na"
              label="Na"
              value={labs.na}
              unit="mEq/L"
              placeholder="例: 140"
              onChange={(v) => updateLabValues({ na: v })}
            />
            <VitalInput
              id="alb"
              label="Alb"
              value={labs.alb}
              unit="g/dL"
              placeholder="例: 3.8"
              onChange={(v) => updateLabValues({ alb: v })}
            />
            <VitalInput
              id="plt"
              label="Plt"
              value={labs.plt}
              unit="万/μL"
              placeholder="例: 18"
              onChange={(v) => updateLabValues({ plt: v })}
            />
            <VitalInput
              id="pt_inr"
              label="PT-INR"
              value={labs.pt_inr}
              unit=""
              placeholder="例: 1.8"
              onChange={(v) => updateLabValues({ pt_inr: v })}
            />
            <div className="col-span-2 space-y-1">
              <Label htmlFor="labs-free-text" className="text-xs text-muted-foreground">
                その他検査値
              </Label>
              <Input
                id="labs-free-text"
                type="text"
                placeholder="その他検査値を入力"
                value={labs.free_text ?? ''}
                onChange={(e) => updateLabValues({ free_text: e.target.value || undefined })}
                className="h-10 text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* Medication Status */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">服薬状況</h3>
        <div className="flex flex-col gap-2">
          {MEDICATION_STATUS_OPTIONS.map((opt) => {
            const isSelected = data.medication_status === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ ...data, medication_status: opt.value })}
                className={`h-14 rounded-lg border px-4 text-sm font-medium transition-colors text-left ${
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

      {/* Adherence Score */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">アドヒアランス（5段階）</h3>
        <div className="flex gap-1">
          {([1, 2, 3, 4, 5] as const).map((score) => {
            const adh = ADHERENCE_LABELS[score];
            const isSelected = data.adherence_score === score;
            return (
              <button
                key={score}
                type="button"
                onClick={() => onChange({ ...data, adherence_score: score })}
                className={`h-12 flex-1 rounded-lg border text-xs font-medium transition-colors ${
                  isSelected
                    ? `${adh.color} border-transparent`
                    : 'border-input bg-background text-foreground hover:bg-accent'
                }`}
                aria-label={`アドヒアランス ${score}: ${adh.label}`}
              >
                {score}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-muted-foreground text-center">
          {ADHERENCE_LABELS[data.adherence_score]?.label ?? '選択してください'}
        </p>
      </div>

      {/* Self Management */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">自己管理能力</h3>
        <div className="grid grid-cols-3 gap-2">
          {SELF_MANAGEMENT_OPTIONS.map((opt) => (
            <ToggleButton
              key={opt.value}
              label={opt.label}
              selected={data.self_management_ability === opt.value}
              onToggle={() =>
                onChange({
                  ...data,
                  self_management_ability:
                    data.self_management_ability === opt.value ? undefined : opt.value,
                })
              }
            />
          ))}
        </div>
      </div>

      {/* Medication Calendar */}
      <div className="flex items-center justify-between rounded-lg border border-input bg-background px-4 py-3">
        <span className="text-sm font-medium text-foreground">服薬カレンダー</span>
        <button
          type="button"
          role="switch"
          aria-checked={data.medication_calendar_used ?? false}
          onClick={() =>
            onChange({
              ...data,
              medication_calendar_used: !(data.medication_calendar_used ?? false),
            })
          }
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
            data.medication_calendar_used ? 'bg-primary' : 'bg-input'
          }`}
        >
          <span
            className={`inline-block size-4 rounded-full bg-white shadow-sm transition-transform ${
              data.medication_calendar_used ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
        <span className="ml-2 text-sm text-muted-foreground">
          {data.medication_calendar_used ? '使用中' : '未使用'}
        </span>
      </div>
    </div>
  );
}
