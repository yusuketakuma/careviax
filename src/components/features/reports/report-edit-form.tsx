'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useOrgId } from '@/lib/hooks/use-org-id';
import type { PhysicianReportContent, CareManagerReportContent } from '@/types/care-report-content';
import { deriveReportComplianceChecks } from './compliance-checklist';

// ─── Expandable section ────────────────────────────────────────────────────────

function EditSection({
  label,
  fieldKey,
  value,
  onChange,
}: {
  label: string;
  fieldKey: string;
  value: string;
  onChange: (key: string, value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = !!value.trim();

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-muted/40"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2 font-medium">
          {label}
          {hasContent && (
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="入力済み" />
          )}
        </span>
        {expanded ? (
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-3 pb-3 pt-2">
          <Label htmlFor={`edit-${fieldKey}`} className="sr-only">
            {label}
          </Label>
          <Textarea
            id={`edit-${fieldKey}`}
            value={value}
            onChange={(e) => onChange(fieldKey, e.target.value)}
            placeholder={`${label}を入力...`}
            rows={4}
            className="resize-y text-sm"
          />
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  fieldKey,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  fieldKey: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (key: string, value: number) => void;
}) {
  return (
    <div className="space-y-1.5 rounded-md border border-border px-3 py-2.5">
      <Label htmlFor={`edit-${fieldKey}`}>{label}</Label>
      <Input
        id={`edit-${fieldKey}`}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(fieldKey, Number(event.target.value))}
      />
    </div>
  );
}

function CheckboxField({
  label,
  fieldKey,
  checked,
  onChange,
}: {
  label: string;
  fieldKey: string;
  checked: boolean;
  onChange: (key: string, value: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onChange(fieldKey, value === true)}
      />
      <span>{label}</span>
    </label>
  );
}

// ─── Physician report edit fields ─────────────────────────────────────────────

type PhysicianFields = {
  compliance_summary: string;
  adherence_score: number;
  self_management: string;
  adverse_has_events: boolean;
  adverse_event_details: string;
  functional_sleep: string;
  functional_cognition: string;
  functional_diet_oral: string;
  functional_mobility: string;
  functional_excretion: string;
  lab_values: string;
  assessment: string;
  plan: string;
  prescription_proposals: string;
  physician_communication: string;
};

function PhysicianEditForm({
  initial,
  onChange,
}: {
  initial: PhysicianReportContent;
  onChange: (fields: PhysicianFields) => void;
}) {
  const [fields, setFields] = useState<PhysicianFields>({
    compliance_summary: initial.medication_management.compliance_summary ?? '',
    adherence_score: initial.medication_management.adherence_score ?? 0,
    self_management: initial.medication_management.self_management ?? '',
    adverse_has_events: initial.adverse_events.has_events ?? false,
    adverse_event_details: initial.adverse_events.details ?? initial.adverse_events.events.join('\n'),
    functional_sleep: initial.functional_assessment.sleep ?? '',
    functional_cognition: initial.functional_assessment.cognition ?? '',
    functional_diet_oral: initial.functional_assessment.diet_oral ?? '',
    functional_mobility: initial.functional_assessment.mobility ?? '',
    functional_excretion: initial.functional_assessment.excretion ?? '',
    lab_values: initial.functional_assessment.lab_values ?? '',
    assessment: initial.assessment ?? '',
    plan: initial.plan ?? '',
    prescription_proposals: initial.prescription_proposals ?? '',
    physician_communication: initial.physician_communication ?? '',
  });

  function handleChange(key: string, value: string | number | boolean) {
    const next = { ...fields, [key]: value };
    setFields(next);
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
        <EditSection label="服薬状況" fieldKey="compliance_summary" value={fields.compliance_summary} onChange={handleChange} />
        <NumberField
          label="服薬遵守スコア"
          fieldKey="adherence_score"
          value={fields.adherence_score}
          min={0}
          max={5}
          onChange={handleChange}
        />
      </div>
      <EditSection label="自己管理状況" fieldKey="self_management" value={fields.self_management} onChange={handleChange} />
      <div className="grid gap-3 md:grid-cols-[14rem_minmax(0,1fr)]">
        <CheckboxField
          label="有害事象あり"
          fieldKey="adverse_has_events"
          checked={fields.adverse_has_events}
          onChange={handleChange}
        />
        <EditSection
          label="有害事象・副作用確認"
          fieldKey="adverse_event_details"
          value={fields.adverse_event_details}
          onChange={handleChange}
        />
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <EditSection label="睡眠・生活リズム" fieldKey="functional_sleep" value={fields.functional_sleep} onChange={handleChange} />
        <EditSection label="認知・理解" fieldKey="functional_cognition" value={fields.functional_cognition} onChange={handleChange} />
        <EditSection label="食事・嚥下・口腔" fieldKey="functional_diet_oral" value={fields.functional_diet_oral} onChange={handleChange} />
        <EditSection label="移動・排泄" fieldKey="functional_mobility" value={fields.functional_mobility} onChange={handleChange} />
      </div>
      <EditSection label="排泄の補足" fieldKey="functional_excretion" value={fields.functional_excretion} onChange={handleChange} />
      <EditSection label="検査値・バイタル補足" fieldKey="lab_values" value={fields.lab_values} onChange={handleChange} />
      <EditSection label="薬学的評価" fieldKey="assessment" value={fields.assessment} onChange={handleChange} />
      <EditSection label="今後の計画" fieldKey="plan" value={fields.plan} onChange={handleChange} />
      <EditSection
        label="処方提案"
        fieldKey="prescription_proposals"
        value={fields.prescription_proposals}
        onChange={handleChange}
      />
      <EditSection
        label="処方医への連絡事項"
        fieldKey="physician_communication"
        value={fields.physician_communication}
        onChange={handleChange}
      />
    </div>
  );
}

// ─── Care manager report edit fields ──────────────────────────────────────────

type CareManagerFields = {
  medication_compliance_summary: string;
  total_drugs: number;
  self_management: string;
  sleep_impact: string;
  cognition_impact: string;
  diet_impact: string;
  mobility_impact: string;
  excretion_impact: string;
  residual_summary: string;
  medication_assistance: string;
  unit_dose_packaging: boolean;
  calendar_recommendation: boolean;
  care_service_other: string;
  next_visit_date: string;
  followup_items_raw: string;
};

function CareManagerEditForm({
  initial,
  onChange,
}: {
  initial: CareManagerReportContent;
  onChange: (fields: CareManagerFields) => void;
}) {
  const [fields, setFields] = useState<CareManagerFields>({
    medication_compliance_summary: initial.medication_management_summary.compliance_summary ?? '',
    total_drugs: initial.medication_management_summary.total_drugs ?? 0,
    self_management: initial.medication_management_summary.self_management ?? '',
    sleep_impact: initial.functional_impact.sleep_impact ?? '',
    cognition_impact: initial.functional_impact.cognition_impact ?? '',
    diet_impact: initial.functional_impact.diet_impact ?? '',
    mobility_impact: initial.functional_impact.mobility_impact ?? '',
    excretion_impact: initial.functional_impact.excretion_impact ?? '',
    residual_summary: initial.residual_status.summary ?? '',
    medication_assistance: initial.care_service_coordination.medication_assistance ?? '',
    unit_dose_packaging: initial.care_service_coordination.unit_dose_packaging ?? false,
    calendar_recommendation: initial.care_service_coordination.calendar_recommendation ?? false,
    care_service_other: initial.care_service_coordination.other_items ?? '',
    next_visit_date: initial.next_visit_plan.date ?? '',
    followup_items_raw: initial.next_visit_plan.followup_items.join('\n'),
  });

  function handleChange(key: string, value: string | number | boolean) {
    const next = { ...fields, [key]: value };
    setFields(next);
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
        <EditSection
          label="服薬管理状況"
          fieldKey="medication_compliance_summary"
          value={fields.medication_compliance_summary}
          onChange={handleChange}
        />
        <NumberField
          label="薬剤数"
          fieldKey="total_drugs"
          value={fields.total_drugs}
          min={0}
          onChange={handleChange}
        />
      </div>
      <EditSection label="自己管理状況" fieldKey="self_management" value={fields.self_management} onChange={handleChange} />
      <div className="grid gap-2 md:grid-cols-2">
        <EditSection label="睡眠への影響" fieldKey="sleep_impact" value={fields.sleep_impact} onChange={handleChange} />
        <EditSection label="認知への影響" fieldKey="cognition_impact" value={fields.cognition_impact} onChange={handleChange} />
        <EditSection label="食事への影響" fieldKey="diet_impact" value={fields.diet_impact} onChange={handleChange} />
        <EditSection label="移動への影響" fieldKey="mobility_impact" value={fields.mobility_impact} onChange={handleChange} />
      </div>
      <EditSection label="排泄への影響" fieldKey="excretion_impact" value={fields.excretion_impact} onChange={handleChange} />
      <EditSection
        label="残薬状況（概要）"
        fieldKey="residual_summary"
        value={fields.residual_summary}
        onChange={handleChange}
      />
      <EditSection
        label="服薬介助・介護サービスへの依頼"
        fieldKey="medication_assistance"
        value={fields.medication_assistance}
        onChange={handleChange}
      />
      <div className="grid gap-2 md:grid-cols-2">
        <CheckboxField
          label="一包化を推奨"
          fieldKey="unit_dose_packaging"
          checked={fields.unit_dose_packaging}
          onChange={handleChange}
        />
        <CheckboxField
          label="服薬カレンダーを推奨"
          fieldKey="calendar_recommendation"
          checked={fields.calendar_recommendation}
          onChange={handleChange}
        />
      </div>
      <EditSection
        label="介護連携事項（その他）"
        fieldKey="care_service_other"
        value={fields.care_service_other}
        onChange={handleChange}
      />
      <div className="space-y-1.5 rounded-md border border-border px-3 py-2.5">
        <Label htmlFor="edit-next_visit_date">次回訪問予定日</Label>
        <Input
          id="edit-next_visit_date"
          type="date"
          value={fields.next_visit_date}
          onChange={(event) => handleChange('next_visit_date', event.target.value)}
        />
      </div>
      <EditSection
        label="フォローアップ項目（1行1項目）"
        fieldKey="followup_items_raw"
        value={fields.followup_items_raw}
        onChange={handleChange}
      />
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

type Props = {
  reportId: string;
  reportType: string;
  content: PhysicianReportContent | CareManagerReportContent;
  onSaved?: () => void;
};

function ComplianceEditGuide({
  reportType,
  content,
}: {
  reportType: string;
  content: PhysicianReportContent | CareManagerReportContent;
}) {
  const checks = deriveReportComplianceChecks(reportType, content);
  const passedCount = checks.filter((item) => item.passed).length;
  const missing = checks.filter((item) => !item.passed);

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="font-medium text-sky-950">算定要件を満たすための編集ナビ</p>
          <p className="text-xs leading-5 text-sky-900/80">
            不足している項目をこの画面で補完すると、右側の算定チェックと送付前確認に反映されます。
          </p>
        </div>
        <Badge variant={missing.length === 0 ? 'default' : 'outline'}>
          {passedCount}/{checks.length} 充足
        </Badge>
      </div>
      {missing.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {missing.map((item) => (
            <Badge key={item.key} variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
              未入力: {item.label}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
          算定要件チェック上の必須項目は充足しています。送付先と送達方法を確認してください。
        </p>
      )}
    </div>
  );
}

export function ReportEditForm({ reportId, reportType, content, onSaved }: Props) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();

  // Accumulated edits from child form. Only one of the two field shapes is ever
  // populated (selected by reportType); the partial intersection lets either set
  // assign without laundering through `Record<string, unknown>`.
  const [pendingFields, setPendingFields] = useState<
    Partial<PhysicianFields & CareManagerFields>
  >({});

  function buildUpdatedContent(): PhysicianReportContent | CareManagerReportContent {
    if (reportType === 'physician_report') {
      const base = content as PhysicianReportContent;
      const f = pendingFields;
      return {
        ...base,
        medication_management: {
          ...base.medication_management,
          compliance_summary: f.compliance_summary ?? base.medication_management.compliance_summary,
          adherence_score: f.adherence_score ?? base.medication_management.adherence_score,
          self_management: f.self_management ?? base.medication_management.self_management,
        },
        adverse_events: {
          ...base.adverse_events,
          has_events: f.adverse_has_events ?? base.adverse_events.has_events,
          details: f.adverse_event_details ?? base.adverse_events.details,
          events:
            f.adverse_event_details != null
              ? String(f.adverse_event_details)
                  .split('\n')
                  .map((item) => item.trim())
                  .filter(Boolean)
              : base.adverse_events.events,
        },
        functional_assessment: {
          ...base.functional_assessment,
          sleep: f.functional_sleep ?? base.functional_assessment.sleep,
          cognition: f.functional_cognition ?? base.functional_assessment.cognition,
          diet_oral: f.functional_diet_oral ?? base.functional_assessment.diet_oral,
          mobility: f.functional_mobility ?? base.functional_assessment.mobility,
          excretion: f.functional_excretion ?? base.functional_assessment.excretion,
          lab_values: f.lab_values ?? base.functional_assessment.lab_values,
        },
        assessment: f.assessment ?? base.assessment,
        plan: f.plan ?? base.plan,
        prescription_proposals: f.prescription_proposals ?? base.prescription_proposals,
        physician_communication: f.physician_communication ?? base.physician_communication,
      };
    } else {
      const base = content as CareManagerReportContent;
      const f = pendingFields;
      return {
        ...base,
        medication_management_summary: {
          ...base.medication_management_summary,
          total_drugs: f.total_drugs ?? base.medication_management_summary.total_drugs,
          compliance_summary:
            f.medication_compliance_summary ??
            base.medication_management_summary.compliance_summary,
          self_management: f.self_management ?? base.medication_management_summary.self_management,
        },
        functional_impact: {
          ...base.functional_impact,
          sleep_impact: f.sleep_impact ?? base.functional_impact.sleep_impact,
          cognition_impact: f.cognition_impact ?? base.functional_impact.cognition_impact,
          diet_impact: f.diet_impact ?? base.functional_impact.diet_impact,
          mobility_impact: f.mobility_impact ?? base.functional_impact.mobility_impact,
          excretion_impact: f.excretion_impact ?? base.functional_impact.excretion_impact,
        },
        residual_status: {
          ...base.residual_status,
          summary: f.residual_summary ?? base.residual_status.summary,
        },
        care_service_coordination: {
          ...base.care_service_coordination,
          medication_assistance:
            f.medication_assistance ?? base.care_service_coordination.medication_assistance,
          unit_dose_packaging:
            f.unit_dose_packaging ?? base.care_service_coordination.unit_dose_packaging,
          calendar_recommendation:
            f.calendar_recommendation ?? base.care_service_coordination.calendar_recommendation,
          other_items: f.care_service_other ?? base.care_service_coordination.other_items,
        },
        next_visit_plan: {
          ...base.next_visit_plan,
          date: f.next_visit_date ?? base.next_visit_plan.date,
          followup_items: f.followup_items_raw
            ? f.followup_items_raw
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
            : base.next_visit_plan.followup_items,
        },
      };
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updatedContent = buildUpdatedContent();
      const res = await fetch(`/api/care-reports/${reportId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ content: updatedContent }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message ?? '保存に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('報告書を保存しました');
      queryClient.invalidateQueries({ queryKey: ['care-report', reportId] });
      queryClient.invalidateQueries({ queryKey: ['care-reports'] });
      onSaved?.();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <ComplianceEditGuide reportType={reportType} content={buildUpdatedContent()} />
      <p className="text-xs text-muted-foreground">
        セクション名をクリックして展開し、訪問記録から生成された内容を薬局内で補正できます。
      </p>

      {reportType === 'physician_report' ? (
        <PhysicianEditForm
          initial={content as PhysicianReportContent}
          onChange={(f) => setPendingFields(f)}
        />
      ) : (
        <CareManagerEditForm
          initial={content as CareManagerReportContent}
          onChange={(f) => setPendingFields(f)}
        />
      )}

      <Button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        className="w-full"
      >
        <Save className="mr-1.5 size-4" aria-hidden="true" />
        {saveMutation.isPending ? '保存中...' : '保存する'}
      </Button>
    </div>
  );
}
