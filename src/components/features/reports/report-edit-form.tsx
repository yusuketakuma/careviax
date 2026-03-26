'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useOrgId } from '@/lib/hooks/use-org-id';
import type { PhysicianReportContent, CareManagerReportContent } from '@/types/care-report-content';

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

// ─── Physician report edit fields ─────────────────────────────────────────────

type PhysicianFields = {
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
    assessment: initial.assessment ?? '',
    plan: initial.plan ?? '',
    prescription_proposals: initial.prescription_proposals ?? '',
    physician_communication: initial.physician_communication ?? '',
  });

  function handleChange(key: string, value: string) {
    const next = { ...fields, [key]: value };
    setFields(next);
    onChange(next);
  }

  return (
    <div className="space-y-2">
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
  residual_summary: string;
  care_service_other: string;
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
    residual_summary: initial.residual_status.summary ?? '',
    care_service_other: initial.care_service_coordination.other_items ?? '',
    followup_items_raw: initial.next_visit_plan.followup_items.join('\n'),
  });

  function handleChange(key: string, value: string) {
    const next = { ...fields, [key]: value };
    setFields(next);
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <EditSection
        label="残薬状況（概要）"
        fieldKey="residual_summary"
        value={fields.residual_summary}
        onChange={handleChange}
      />
      <EditSection
        label="介護連携事項（その他）"
        fieldKey="care_service_other"
        value={fields.care_service_other}
        onChange={handleChange}
      />
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

export function ReportEditForm({ reportId, reportType, content, onSaved }: Props) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();

  // Accumulated edits from child form
  const [pendingFields, setPendingFields] = useState<Record<string, string>>({});

  function buildUpdatedContent(): Record<string, unknown> {
    if (reportType === 'physician_report') {
      const base = content as PhysicianReportContent;
      const f = pendingFields as PhysicianFields;
      return {
        ...base,
        assessment: f.assessment ?? base.assessment,
        plan: f.plan ?? base.plan,
        prescription_proposals: f.prescription_proposals ?? base.prescription_proposals,
        physician_communication: f.physician_communication ?? base.physician_communication,
      };
    } else {
      const base = content as CareManagerReportContent;
      const f = pendingFields as CareManagerFields;
      return {
        ...base,
        residual_status: {
          ...base.residual_status,
          summary: f.residual_summary ?? base.residual_status.summary,
        },
        care_service_coordination: {
          ...base.care_service_coordination,
          other_items: f.care_service_other ?? base.care_service_coordination.other_items,
        },
        next_visit_plan: {
          ...base.next_visit_plan,
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
      <p className="text-xs text-muted-foreground">
        セクション名をクリックして展開し、内容を編集できます。
      </p>

      {reportType === 'physician_report' ? (
        <PhysicianEditForm
          initial={content as PhysicianReportContent}
          onChange={(f) => setPendingFields(f as unknown as Record<string, string>)}
        />
      ) : (
        <CareManagerEditForm
          initial={content as CareManagerReportContent}
          onChange={(f) => setPendingFields(f as unknown as Record<string, string>)}
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
