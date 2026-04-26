'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ClipboardCheck, FileText, Stethoscope, UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  buildHomeVisit2026ReadinessItems,
  readHomeVisit2026Evidence,
  type HomeVisit2026BillingBlocker,
} from '@/lib/visits/home-visit-2026-evidence';
import type { HomeVisit2026Evidence, StructuredSoap } from '@/types/structured-soap';

type VisitMedicationManagementSectionProps = {
  structuredSoap: StructuredSoap;
  visitType?: string | null;
  residualMedicationCount?: number;
  billingBlockers?: HomeVisit2026BillingBlocker[];
  intakeInitialTransitionExpected?: boolean | null;
  conferenceContext?: VisitConferenceContext[];
  medicationPeriod?: VisitMedicationPeriod | null;
  prescriptionChanges?: VisitPrescriptionChanges | null;
  previousVisitSummary?: string | null;
  onChange: (next: StructuredSoap) => void;
};

export type VisitConferenceContext = {
  id: string;
  note_type: 'pre_discharge' | 'service_manager';
  title: string;
  conference_date: string;
  participants: Array<{
    name: string | null;
    role: string | null;
  }>;
  highlights: string[];
  action_items: string[];
  sync_summary?: {
    billing_candidate_id?: string | null;
    visit_proposal_id?: string | null;
    report_draft_ids?: string[];
    tasks_created?: number;
    medication_issues_created?: number;
  } | null;
};

export type VisitMedicationPeriod = {
  schedule_start_date: string | null;
  schedule_end_date: string | null;
  prescription_start_date: string | null;
  prescription_end_date: string | null;
};

export type VisitPrescriptionChanges = {
  current_prescribed_date: string;
  previous_prescribed_date: string | null;
  source_type: string;
  added: string[];
  changed: Array<{
    drug_name: string;
    reasons: string[];
  }>;
  removed: string[];
};

const safetyReasonOptions = [
  { value: 'agitation', label: '興奮・運動興奮' },
  { value: 'aggression', label: '攻撃性・暴力リスク' },
  { value: 'severe_anxiety', label: '強い不安・拒否' },
  { value: 'self_harm_risk', label: '自傷リスク' },
  { value: 'other', label: 'その他' },
] as const;

function EvidenceCheckbox({
  id,
  checked,
  label,
  description,
  onCheckedChange,
}: {
  id: string;
  checked: boolean;
  label: string;
  description: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-background px-3 py-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="mt-0.5"
      />
      <div className="space-y-1">
        <Label htmlFor={id} className="cursor-pointer text-sm font-medium text-foreground">
          {label}
        </Label>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function conferenceLabel(noteType: VisitConferenceContext['note_type']) {
  return noteType === 'pre_discharge' ? '退院前カンファ' : '担当者会議';
}

function formatConferenceDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.getFullYear()}/${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) return '未設定';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.getFullYear()}/${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

function prescriptionChangeSummary(changes: VisitPrescriptionChanges | null | undefined) {
  if (!changes) return '処方取込情報なし';
  const parts = [
    changes.added.length > 0 ? `追加 ${changes.added.length}` : null,
    changes.changed.length > 0 ? `変更 ${changes.changed.length}` : null,
    changes.removed.length > 0 ? `中止 ${changes.removed.length}` : null,
  ].filter((value): value is string => value != null);
  return parts.length > 0 ? parts.join(' / ') : '前回から大きな変更なし';
}

function VisitMedicationCarryForwardBlock({
  medicationPeriod,
  prescriptionChanges,
  previousVisitSummary,
}: {
  medicationPeriod?: VisitMedicationPeriod | null;
  prescriptionChanges?: VisitPrescriptionChanges | null;
  previousVisitSummary?: string | null;
}) {
  const startDate =
    medicationPeriod?.schedule_start_date ?? medicationPeriod?.prescription_start_date ?? null;
  const endDate =
    medicationPeriod?.schedule_end_date ?? medicationPeriod?.prescription_end_date ?? null;
  const changedItems = prescriptionChanges?.changed.flatMap((item) =>
    item.reasons.map((reason) => `${item.drug_name}: ${reason}`),
  );
  const changeLines = [
    ...(prescriptionChanges?.added ?? []).map((name) => `追加: ${name}`),
    ...(changedItems ?? []),
    ...(prescriptionChanges?.removed ?? []).map((name) => `中止: ${name}`),
  ];

  if (!medicationPeriod && !prescriptionChanges && !previousVisitSummary) return null;

  return (
    <section className="grid gap-3 lg:grid-cols-3">
      <div className="rounded-lg border border-border/70 bg-background px-3 py-3">
        <p className="text-xs font-medium text-muted-foreground">服用期間</p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          {formatDateLabel(startDate)} - {formatDateLabel(endDate)}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          訪問予定の服用期間を優先し、未設定時は最新処方の開始・終了日を表示します。
        </p>
      </div>
      <div className="rounded-lg border border-border/70 bg-background px-3 py-3">
        <p className="text-xs font-medium text-muted-foreground">薬剤変更内容</p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          {prescriptionChangeSummary(prescriptionChanges)}
        </p>
        {changeLines.length > 0 ? (
          <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
            {changeLines.slice(0, 4).map((line, index) => (
              <li key={`${line}-${index}`}>・{line}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="rounded-lg border border-border/70 bg-background px-3 py-3">
        <p className="text-xs font-medium text-muted-foreground">前回までの要約</p>
        <p className="mt-1 text-sm leading-6 text-foreground">
          {previousVisitSummary ?? '前回記録なし'}
        </p>
      </div>
    </section>
  );
}

function ConferenceContextBlock({ notes }: { notes: VisitConferenceContext[] }) {
  if (notes.length === 0) return null;

  return (
    <section className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/50 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-sky-950">
            <FileText className="size-4 text-sky-700" aria-hidden="true" />
            会議からの引き継ぎ
          </h3>
          <p className="text-xs leading-5 text-sky-900/80">
            退院前カンファ・担当者会議で決まった内容を、この訪問の確認事項として扱います。
          </p>
        </div>
        <Badge variant="outline" className="w-fit border-sky-300 bg-white text-sky-900">
          {notes.length}件
        </Badge>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {notes.slice(0, 2).map((note) => (
          <article key={note.id} className="rounded-lg border border-sky-200 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <Badge variant="outline" className="border-sky-200 text-sky-900">
                  {conferenceLabel(note.note_type)}
                </Badge>
                <h4 className="text-sm font-semibold text-foreground">{note.title}</h4>
                <p className="text-xs text-muted-foreground">
                  {formatConferenceDate(note.conference_date)}
                  {note.participants.length > 0
                    ? ` / ${note.participants
                        .slice(0, 3)
                        .map((participant) => participant.name ?? participant.role ?? '参加者')
                        .join('、')}`
                    : ''}
                </p>
              </div>
              <Link
                href={`/conferences?note_type=${note.note_type}&focus=notes`}
                className="inline-flex min-h-8 items-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                会議一覧
              </Link>
            </div>

            {note.highlights.length > 0 ? (
              <ul className="mt-3 space-y-1.5 text-xs leading-5 text-sky-950">
                {note.highlights.slice(0, 4).map((highlight, index) => (
                  <li key={`${note.id}-highlight-${index}`}>・{highlight}</li>
                ))}
              </ul>
            ) : null}

            {note.action_items.length > 0 ? (
              <div className="mt-3 rounded-lg border border-sky-100 bg-sky-50 px-2.5 py-2">
                <p className="text-[11px] font-semibold text-sky-900">今日拾う合意事項</p>
                <ul className="mt-1 space-y-1 text-xs leading-5 text-sky-950">
                  {note.action_items.slice(0, 3).map((item, index) => (
                    <li key={`${note.id}-action-${index}`}>・{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function FieldText({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string | undefined;
  placeholder: string;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    </div>
  );
}

function FieldTextarea({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string | undefined;
  placeholder: string;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Textarea
        id={id}
        value={value ?? ''}
        placeholder={placeholder}
        rows={3}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    </div>
  );
}

function Section({
  title,
  description,
  checked,
  onCheckedChange,
  children,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-border/70 bg-muted/10 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={title} />
      </div>
      {checked ? <div className="grid gap-3 lg:grid-cols-2">{children}</div> : null}
    </section>
  );
}

function EvidenceGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function VisitMedicationManagementSection({
  structuredSoap,
  visitType,
  residualMedicationCount = 0,
  billingBlockers = [],
  intakeInitialTransitionExpected,
  conferenceContext = [],
  medicationPeriod,
  prescriptionChanges,
  previousVisitSummary,
  onChange,
}: VisitMedicationManagementSectionProps) {
  const evidence = readHomeVisit2026Evidence(structuredSoap);
  const readinessItems = buildHomeVisit2026ReadinessItems({
    structuredSoap,
    visitType,
    residualMedicationCount,
    billingBlockers,
    intakeInitialTransitionExpected,
  });
  const requiredItems = readinessItems.filter((item) => item.required);
  const completedRequiredItems = requiredItems.filter((item) => item.done);
  const missingItems = requiredItems.filter((item) => !item.done);
  const isReady = requiredItems.length === completedRequiredItems.length;

  function updateEvidence(patch: Partial<HomeVisit2026Evidence>) {
    onChange({
      ...structuredSoap,
      home_visit_2026: {
        ...evidence,
        ...patch,
      },
    });
  }

  function updatePhysicianSimultaneous(
    patch: NonNullable<HomeVisit2026Evidence['physician_simultaneous']>,
  ) {
    updateEvidence({
      physician_simultaneous: {
        ...evidence.physician_simultaneous,
        ...patch,
      },
    });
  }

  function updateMultiStaff(patch: NonNullable<HomeVisit2026Evidence['multi_staff_visit']>) {
    updateEvidence({
      multi_staff_visit: {
        ...evidence.multi_staff_visit,
        ...patch,
      },
    });
  }

  function updateInitialTransition(
    patch: NonNullable<HomeVisit2026Evidence['initial_transition_management']>,
  ) {
    updateEvidence({
      initial_transition_management: {
        ...evidence.initial_transition_management,
        ...patch,
      },
    });
  }

  const initialTransitionSuggested =
    visitType === 'initial' || intakeInitialTransitionExpected === true;
  const initialTransitionChecked =
    evidence.initial_transition_management?.target ?? initialTransitionSuggested;

  return (
    <div className="space-y-4" data-testid="visit-medication-management-section">
      <div className="space-y-3 rounded-xl border border-border/70 bg-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ClipboardCheck className="size-4 text-emerald-700" aria-hidden="true" />
              本日の訪問薬剤管理
            </h3>
            <p className="text-xs leading-5 text-muted-foreground">
              会議・退院時情報・通常訪問で必要な確認を、訪問記録の最初にまとめて閉じます。
            </p>
          </div>
          <Badge variant={isReady ? 'default' : 'outline'} className="w-fit">
            必須 {completedRequiredItems.length}/{requiredItems.length}
          </Badge>
        </div>
        <div
          className={cn(
            'rounded-lg border px-3 py-2 text-sm',
            isReady
              ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
              : 'border-amber-200 bg-amber-50/80 text-amber-950',
          )}
          role="status"
          aria-live="polite"
        >
          {isReady
            ? 'この訪問で必要な確認は揃っています。'
            : `次に確認: ${missingItems
                .slice(0, 3)
                .map((item) => item.label)
                .join(' / ')}`}
        </div>
        <div className="rounded-lg border border-border/70 bg-muted/10 px-3 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-foreground">訪問中に見る不足</p>
            <Badge variant="outline" className="w-fit">
              未確認 {missingItems.length}件
            </Badge>
          </div>
          {missingItems.length === 0 ? (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              必須項目は揃っています。下の各項目は必要時の追記として確認できます。
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {missingItems.slice(0, 8).map((item) => (
                <span
                  key={item.key}
                  className={cn(
                    'inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-xs font-medium',
                    item.severity === 'urgent' || item.severity === 'high'
                      ? 'border-amber-200 bg-amber-50 text-amber-950'
                      : 'border-border/70 bg-background text-foreground',
                  )}
                >
                  {item.label}
                </span>
              ))}
              {missingItems.length > 8 ? (
                <span className="inline-flex min-h-7 items-center rounded-full border border-border/70 bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  他 {missingItems.length - 8}件
                </span>
              ) : null}
            </div>
          )}
        </div>
        <VisitMedicationCarryForwardBlock
          medicationPeriod={medicationPeriod}
          prescriptionChanges={prescriptionChanges}
          previousVisitSummary={previousVisitSummary}
        />
      </div>

      <ConferenceContextBlock notes={conferenceContext} />

      <div className="space-y-5 rounded-xl border border-border/70 bg-card p-4">
        <EvidenceGroup
          title="全訪問で確認すること"
          description="通常訪問でも、報告書と請求根拠に最低限残したい薬学的管理です。"
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <EvidenceCheckbox
              id="evidence-medication-review"
              checked={Boolean(evidence.medication_review_completed)}
              label="服薬状況を確認した"
              description="服薬状況、アドヒアランス、服薬支援の状態を確認済みにします。"
              onCheckedChange={(checked) =>
                updateEvidence({ medication_review_completed: checked })
              }
            />
            <EvidenceCheckbox
              id="evidence-residual"
              checked={Boolean(evidence.residual_medication_checked)}
              label="残薬を確認した"
              description="残薬なしの場合も、確認した事実を明示できます。"
              onCheckedChange={(checked) =>
                updateEvidence({ residual_medication_checked: checked })
              }
            />
            <EvidenceCheckbox
              id="evidence-adverse-event"
              checked={Boolean(evidence.adverse_event_checked)}
              label="副作用・有害事象を確認した"
              description="訴えがない場合でも、確認済みとして報告書材料に残します。"
              onCheckedChange={(checked) => updateEvidence({ adverse_event_checked: checked })}
            />
            <EvidenceCheckbox
              id="evidence-polypharmacy"
              checked={Boolean(evidence.polypharmacy_reviewed)}
              label="重複投薬・相互作用を確認した"
              description="医師同時訪問や処方提案の前提になる薬学的評価です。"
              onCheckedChange={(checked) => updateEvidence({ polypharmacy_reviewed: checked })}
            />
            <EvidenceCheckbox
              id="evidence-after-hours"
              checked={Boolean(evidence.after_hours_contact_confirmed)}
              label="夜間休日の連絡体制を確認した"
              description="開局時間外の調剤・訪問薬剤管理指導の連絡体制を確認します。"
              onCheckedChange={(checked) =>
                updateEvidence({ after_hours_contact_confirmed: checked })
              }
            />
          </div>
        </EvidenceGroup>

        <EvidenceGroup
          title="該当時だけ詳しく残すこと"
          description="初回・医師同時訪問・複数名訪問など、算定候補になった時だけ開いて根拠を残します。"
        >
          <div className="space-y-3">
            <Section
              title="在宅移行初期管理"
              description="初回訪問・在宅移行時に、生活環境と薬学的リスクを前倒しで記録します。"
              checked={initialTransitionChecked}
              onCheckedChange={(checked) => updateInitialTransition({ target: checked })}
            >
              <EvidenceCheckbox
                id="initial-environment"
                checked={Boolean(
                  evidence.initial_transition_management?.pre_visit_environment_assessed,
                )}
                label="生活環境・服薬支援体制を確認"
                description="患家環境、介護者、保管場所、服薬支援の状態を確認します。"
                onCheckedChange={(checked) =>
                  updateInitialTransition({
                    pre_visit_environment_assessed: checked,
                    target: true,
                  })
                }
              />
              <EvidenceCheckbox
                id="initial-medication-risk"
                checked={Boolean(evidence.initial_transition_management?.medication_risk_assessed)}
                label="在宅移行時の薬学的リスクを確認"
                description="副作用、残薬、服薬困難、相互作用、退院時変更点を確認します。"
                onCheckedChange={(checked) =>
                  updateInitialTransition({ medication_risk_assessed: checked, target: true })
                }
              />
              <div className="lg:col-span-2">
                <FieldTextarea
                  id="initial-transition-summary"
                  label="初期移行支援の要点"
                  value={evidence.initial_transition_management?.transition_support_summary}
                  placeholder="例: 退院後の服薬管理が不安定。家族へ一包化運用と残薬確認方法を説明し、主治医へ眠気とふらつきを共有。"
                  onChange={(value) =>
                    updateInitialTransition({ transition_support_summary: value, target: true })
                  }
                />
              </div>
            </Section>

            <Section
              title="医師同時訪問"
              description="医師と薬剤師が同時に患家を訪問し、残薬・副作用・用法剤形などを共同で確認した場合に記録します。"
              checked={Boolean(evidence.physician_simultaneous?.performed)}
              onCheckedChange={(checked) => updatePhysicianSimultaneous({ performed: checked })}
            >
              <EvidenceCheckbox
                id="physician-simultaneous-consent"
                checked={Boolean(evidence.physician_simultaneous?.patient_consent)}
                label="患者・家族等の同意あり"
                description="同時訪問に関する同意を取得したことを記録します。"
                onCheckedChange={(checked) =>
                  updatePhysicianSimultaneous({ patient_consent: checked, performed: true })
                }
              />
              <EvidenceCheckbox
                id="physician-simultaneous-discussed"
                checked={Boolean(evidence.physician_simultaneous?.medication_adjustment_discussed)}
                label="薬物療法最適化を協議した"
                description="処方変更がなくても、残薬・服薬状況・副作用等の協議内容を残します。"
                onCheckedChange={(checked) =>
                  updatePhysicianSimultaneous({
                    medication_adjustment_discussed: checked,
                    performed: true,
                  })
                }
              />
              <FieldText
                id="physician-simultaneous-name"
                label="同時訪問した医師名"
                value={evidence.physician_simultaneous?.physician_name}
                placeholder="例: 山田 太郎"
                onChange={(value) =>
                  updatePhysicianSimultaneous({ physician_name: value, performed: true })
                }
              />
              <FieldText
                id="physician-simultaneous-institution"
                label="医療機関"
                value={evidence.physician_simultaneous?.physician_institution}
                placeholder="例: 在宅クリニック"
                onChange={(value) =>
                  updatePhysicianSimultaneous({ physician_institution: value, performed: true })
                }
              />
              <EvidenceCheckbox
                id="physician-simultaneous-exclusion"
                checked={Boolean(evidence.physician_simultaneous?.same_day_exclusion_checked)}
                label="同日併算定制限を確認"
                description="在宅患者緊急時等共同指導料・在宅移行初期管理料との同日重複を確認します。"
                onCheckedChange={(checked) =>
                  updatePhysicianSimultaneous({
                    same_day_exclusion_checked: checked,
                    performed: true,
                  })
                }
              />
              <div className="lg:col-span-2">
                <FieldTextarea
                  id="physician-simultaneous-summary"
                  label="協議内容"
                  value={evidence.physician_simultaneous?.discussion_summary}
                  placeholder="例: 残薬14日分と日中傾眠を確認。睡眠薬減量と服薬カレンダー運用を医師と協議。"
                  onChange={(value) =>
                    updatePhysicianSimultaneous({ discussion_summary: value, performed: true })
                  }
                />
              </div>
            </Section>

            <Section
              title="複数名訪問"
              description="患者の興奮・攻撃性などにより、単独では安全かつ確実な指導が担保できない場合に記録します。"
              checked={Boolean(evidence.multi_staff_visit?.performed)}
              onCheckedChange={(checked) => updateMultiStaff({ performed: checked })}
            >
              <EvidenceCheckbox
                id="multi-staff-consent"
                checked={Boolean(evidence.multi_staff_visit?.patient_consent)}
                label="患者・家族等の同意あり"
                description="複数名で訪問することへの同意を記録します。"
                onCheckedChange={(checked) =>
                  updateMultiStaff({ patient_consent: checked, performed: true })
                }
              />
              <EvidenceCheckbox
                id="multi-staff-physician-need"
                checked={Boolean(evidence.multi_staff_visit?.physician_need_confirmed)}
                label="医師が複数名訪問の必要性を認めた"
                description="薬局都合ではなく、安全な指導実施のための必要性として確認します。"
                onCheckedChange={(checked) =>
                  updateMultiStaff({ physician_need_confirmed: checked, performed: true })
                }
              />
              <div className="space-y-1.5">
                <Label htmlFor="multi-staff-reason" className="text-xs text-muted-foreground">
                  安全上の理由
                </Label>
                <Select
                  value={evidence.multi_staff_visit?.safety_reason ?? ''}
                  onValueChange={(value) =>
                    updateMultiStaff({
                      safety_reason: value as NonNullable<
                        HomeVisit2026Evidence['multi_staff_visit']
                      >['safety_reason'],
                      performed: true,
                    })
                  }
                >
                  <SelectTrigger id="multi-staff-reason">
                    <SelectValue placeholder="理由を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {safetyReasonOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <FieldText
                id="multi-staff-companion"
                label="同行者名"
                value={evidence.multi_staff_visit?.companion_name}
                placeholder="例: 佐藤 花子"
                onChange={(value) => updateMultiStaff({ companion_name: value, performed: true })}
              />
              <FieldText
                id="multi-staff-role"
                label="同行者の役割"
                value={evidence.multi_staff_visit?.companion_role}
                placeholder="例: 薬剤師 / 事務 / 介護職"
                onChange={(value) => updateMultiStaff({ companion_role: value, performed: true })}
              />
              <div className="lg:col-span-2">
                <FieldTextarea
                  id="multi-staff-summary"
                  label="必要性の記録"
                  value={evidence.multi_staff_visit?.necessity_summary}
                  placeholder="例: 前回訪問時に強い拒否と興奮があり、服薬確認を安全に行うため医師確認の上で2名訪問。"
                  onChange={(value) =>
                    updateMultiStaff({ necessity_summary: value, performed: true })
                  }
                />
              </div>
            </Section>
          </div>
        </EvidenceGroup>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Stethoscope className="size-3.5" aria-hidden="true" />
          <span>
            医師同時訪問と複数名訪問の候補化は、単一建物1人などの請求条件と合わせてサーバー側で判定します。
          </span>
          <UsersRound className="size-3.5" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
