'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  ClipboardCheck,
  ClipboardList,
  History,
  MessageSquareText,
  PenLine,
  Pill,
  Stethoscope,
  UsersRound,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

type QuickCaptureTarget = 'subjective' | 'objective' | 'assessment' | 'plan';

type QuickCaptureAction = {
  label: string;
  target: QuickCaptureTarget;
  text: string;
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

function SourcePanel({ children, empty }: { children?: ReactNode; empty?: string }) {
  return children ? (
    <div className="rounded-lg border border-border/70 bg-background p-3">{children}</div>
  ) : (
    <div className="rounded-lg border border-dashed border-border/70 bg-background px-3 py-5 text-sm text-muted-foreground">
      {empty ?? 'この情報ソースには表示できる内容がありません。'}
    </div>
  );
}

function SourceList({ items }: { items: string[] }) {
  if (items.length === 0) return null;

  return (
    <ul className="space-y-1.5 text-sm leading-6 text-foreground">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex gap-2">
          <span
            className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/50"
            aria-hidden="true"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function SourceSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function QuickCapturePanel({
  title,
  prompts,
  actions,
  onQuickCapture,
}: {
  title: string;
  prompts: string[];
  actions: QuickCaptureAction[];
  onQuickCapture?: (action: QuickCaptureAction) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-cyan-200 bg-cyan-50/70 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-cyan-950">
        <MessageSquareText className="size-3.5 text-cyan-800" aria-hidden="true" />
        {title}
      </div>
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <ul className="space-y-1 text-xs leading-5 text-cyan-950">
          {prompts.map((prompt) => (
            <li key={prompt} className="flex gap-2">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-cyan-700" aria-hidden="true" />
              <span>{prompt}</span>
            </li>
          ))}
        </ul>
        {onQuickCapture ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:min-w-48 md:grid-cols-1">
            {actions.map((action) => (
              <Button
                key={`${action.target}-${action.label}`}
                type="button"
                variant="outline"
                size="sm"
                className="justify-start bg-white text-xs"
                onClick={() => onQuickCapture(action)}
              >
                <PenLine className="size-3.5" aria-hidden="true" />
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function buildMedicationChangeLines(
  prescriptionChanges: VisitPrescriptionChanges | null | undefined,
) {
  const changedItems = prescriptionChanges?.changed.flatMap((item) =>
    item.reasons.map((reason) => `${item.drug_name}: ${reason}`),
  );

  return [
    ...(prescriptionChanges?.added ?? []).map((name) => `追加: ${name}`),
    ...(changedItems ?? []),
    ...(prescriptionChanges?.removed ?? []).map((name) => `中止: ${name}`),
  ];
}

function buildSoapHandoffLines(structuredSoap: StructuredSoap) {
  return [
    structuredSoap.plan.physician_report_items
      ? `医師へ: ${structuredSoap.plan.physician_report_items}`
      : null,
    structuredSoap.plan.care_manager_report_items
      ? `ケアマネへ: ${structuredSoap.plan.care_manager_report_items}`
      : null,
    structuredSoap.plan.care_service_coordination
      ? `介護サービスへ: ${structuredSoap.plan.care_service_coordination}`
      : null,
  ].filter((value): value is string => value != null && value.trim().length > 0);
}

function VisitInformationSourceTabs({
  structuredSoap,
  medicationPeriod,
  prescriptionChanges,
  previousVisitSummary,
  conferenceContext,
  onQuickCapture,
}: {
  structuredSoap: StructuredSoap;
  medicationPeriod?: VisitMedicationPeriod | null;
  prescriptionChanges?: VisitPrescriptionChanges | null;
  previousVisitSummary?: string | null;
  conferenceContext: VisitConferenceContext[];
  onQuickCapture?: (action: QuickCaptureAction) => void;
}) {
  const startDate =
    medicationPeriod?.schedule_start_date ?? medicationPeriod?.prescription_start_date ?? null;
  const endDate =
    medicationPeriod?.schedule_end_date ?? medicationPeriod?.prescription_end_date ?? null;
  const changeLines = buildMedicationChangeLines(prescriptionChanges);
  const handoffLines = buildSoapHandoffLines(structuredSoap);
  const conferenceActionLines = conferenceContext.flatMap((note) =>
    note.action_items.map((item) => `${conferenceLabel(note.note_type)}: ${item}`),
  );
  const conferenceHighlightLines = conferenceContext.flatMap((note) =>
    note.highlights.map((highlight) => `${conferenceLabel(note.note_type)}: ${highlight}`),
  );

  const tabs = [
    {
      value: 'prescription',
      label: '処方内容',
      icon: Pill,
      count: changeLines.length,
    },
    {
      value: 'previous',
      label: '前回記録',
      icon: History,
      count: previousVisitSummary ? 1 : 0,
    },
    {
      value: 'team',
      label: '他職種',
      icon: UsersRound,
      count: conferenceContext.length,
    },
    {
      value: 'handoff',
      label: '申し送り',
      icon: ClipboardList,
      count: handoffLines.length + conferenceActionLines.length,
    },
  ] as const;
  const hasPrescriptionAttention = changeLines.length > 0 || Boolean(medicationPeriod);
  const hasPreviousAttention = Boolean(previousVisitSummary);
  const hasTeamAttention = conferenceContext.length > 0;
  const hasHandoffAttention = handoffLines.length > 0 || conferenceActionLines.length > 0;

  return (
    <section className="space-y-3 rounded-xl border border-cyan-200 bg-cyan-50/50 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-cyan-950">今日の聞き取りブリーフ</h3>
          <p className="text-xs leading-5 text-cyan-900/80">
            情報ソースを切り替えて、患者へ向き合う前に今日拾う話題だけを確認します。
          </p>
        </div>
        <Badge variant="outline" className="w-fit border-cyan-300 bg-white text-cyan-900">
          情報ソース別
        </Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-cyan-200 bg-white/70 px-3 py-2">
          <p className="text-[11px] font-semibold text-cyan-950">処方</p>
          <p className="mt-1 text-xs text-cyan-900">
            {hasPrescriptionAttention ? prescriptionChangeSummary(prescriptionChanges) : '変化なし'}
          </p>
        </div>
        <div className="rounded-lg border border-cyan-200 bg-white/70 px-3 py-2">
          <p className="text-[11px] font-semibold text-cyan-950">前回</p>
          <p className="mt-1 text-xs text-cyan-900">
            {hasPreviousAttention ? '要約あり' : '記録なし'}
          </p>
        </div>
        <div className="rounded-lg border border-cyan-200 bg-white/70 px-3 py-2">
          <p className="text-[11px] font-semibold text-cyan-950">他職種</p>
          <p className="mt-1 text-xs text-cyan-900">
            {hasTeamAttention ? `${conferenceContext.length}件` : '共有なし'}
          </p>
        </div>
        <div className="rounded-lg border border-cyan-200 bg-white/70 px-3 py-2">
          <p className="text-[11px] font-semibold text-cyan-950">申し送り</p>
          <p className="mt-1 text-xs text-cyan-900">
            {hasHandoffAttention
              ? `${handoffLines.length + conferenceActionLines.length}件`
              : 'なし'}
          </p>
        </div>
      </div>

      <Tabs defaultValue="prescription" className="gap-3">
        <TabsList
          variant="line"
          className="grid min-h-11 w-full grid-cols-2 justify-start gap-1 border-b border-cyan-200 p-0 sm:flex sm:gap-2"
          aria-label="訪問時に確認する情報ソース"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="min-w-0 flex-none gap-1.5 rounded-none px-2 py-2 text-xs sm:min-w-fit sm:gap-2 sm:px-3"
              >
                <Icon className="size-4" aria-hidden="true" />
                {tab.label}
                <Badge variant="outline" className="ml-0.5 h-5 rounded-full px-1.5 text-[10px]">
                  {tab.count}
                </Badge>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="prescription" className="space-y-3">
          <QuickCapturePanel
            title="次に聞く"
            prompts={[
              '追加・中止薬を本人の言葉で確認する',
              '飲み始め、飲み終わり、残薬とのずれを確認する',
            ]}
            actions={[
              {
                label: '変更理解をSへ',
                target: 'subjective',
                text: '処方変更の理解、飲み始め・中止タイミングを本人へ確認。',
              },
              {
                label: '残薬確認をOへ',
                target: 'objective',
                text: '処方変更に伴う残薬、服用期間、手元薬とのずれを確認。',
              },
            ]}
            onQuickCapture={onQuickCapture}
          />
          <SourcePanel>
            <div className="grid gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
              <SourceSection label="服用期間">
                <p className="text-base font-semibold text-foreground">
                  {formatDateLabel(startDate)} - {formatDateLabel(endDate)}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  訪問予定の服用期間を優先し、未設定時は最新処方の開始・終了日を表示します。
                </p>
              </SourceSection>
              <SourceSection label="薬剤変更内容">
                <p className="text-sm font-semibold text-foreground">
                  {prescriptionChangeSummary(prescriptionChanges)}
                </p>
                <div className="mt-2">
                  <SourceList items={changeLines.slice(0, 6)} />
                </div>
              </SourceSection>
            </div>
          </SourcePanel>
        </TabsContent>

        <TabsContent value="previous" className="space-y-3">
          <QuickCapturePanel
            title="次に聞く"
            prompts={[
              '前回の困りごとが続いているか確認する',
              '飲み忘れ、副作用、生活変化を短く聞く',
            ]}
            actions={[
              {
                label: '前回課題をSへ',
                target: 'subjective',
                text: '前回課題の継続有無、服薬上の困りごと、生活変化を確認。',
              },
              {
                label: '評価観点をAへ',
                target: 'assessment',
                text: '前回課題を踏まえ、次回までの確認事項と連携先への共有要否を整理。',
              },
            ]}
            onQuickCapture={onQuickCapture}
          />
          <SourcePanel empty="前回記録の要約はまだありません。">
            {previousVisitSummary ? (
              <SourceSection label="前回までの要約">
                <p className="text-sm leading-6 text-foreground">{previousVisitSummary}</p>
              </SourceSection>
            ) : null}
          </SourcePanel>
        </TabsContent>

        <TabsContent value="team" className="space-y-3">
          <QuickCapturePanel
            title="次に聞く"
            prompts={[
              '他職種からの心配ごとを本人に確認する',
              '共有すべき返答や追加観察をその場で拾う',
            ]}
            actions={[
              {
                label: '本人確認をSへ',
                target: 'subjective',
                text: '他職種からの共有事項について、本人・家族へ確認。',
              },
              {
                label: '共有方針をPへ',
                target: 'plan',
                text: '他職種へ共有する観察事項、返答、次回確認事項を整理。',
              },
            ]}
            onQuickCapture={onQuickCapture}
          />
          <SourcePanel empty="会議・他職種共有からの表示対象はありません。">
            {conferenceContext.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {conferenceContext.slice(0, 2).map((note) => (
                  <article
                    key={note.id}
                    className="space-y-3 rounded-lg border border-sky-100 bg-sky-50/60 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        <Badge variant="outline" className="border-sky-200 bg-white text-sky-900">
                          {conferenceLabel(note.note_type)}
                        </Badge>
                        <h4 className="text-sm font-semibold text-foreground">{note.title}</h4>
                        <p className="text-xs text-muted-foreground">
                          {formatConferenceDate(note.conference_date)}
                          {note.participants.length > 0
                            ? ` / ${note.participants
                                .slice(0, 3)
                                .map(
                                  (participant) => participant.name ?? participant.role ?? '参加者',
                                )
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
                    <SourceList items={note.highlights.slice(0, 4)} />
                  </article>
                ))}
              </div>
            ) : null}
          </SourcePanel>
        </TabsContent>

        <TabsContent value="handoff" className="space-y-3">
          <QuickCapturePanel
            title="次に聞く"
            prompts={[
              '医師、ケアマネ、介護サービスへ渡す事項を分ける',
              '今日中に返すべき確認事項だけ先に確定する',
            ]}
            actions={[
              {
                label: '申し送りをPへ',
                target: 'plan',
                text: '医師・ケアマネ・介護サービスへ申し送る事項を整理。',
              },
              {
                label: '本人返答をSへ',
                target: 'subjective',
                text: '申し送り事項に対する本人・家族の返答を確認。',
              },
            ]}
            onQuickCapture={onQuickCapture}
          />
          <SourcePanel empty="申し送り事項はまだありません。">
            {handoffLines.length > 0 || conferenceActionLines.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                <SourceSection label="記録から送る事項">
                  <SourceList items={handoffLines} />
                </SourceSection>
                <SourceSection label="会議・他職種から今日拾うこと">
                  <SourceList items={conferenceActionLines.slice(0, 6)} />
                </SourceSection>
              </div>
            ) : null}
          </SourcePanel>
        </TabsContent>
      </Tabs>

      {conferenceHighlightLines.length > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-cyan-200 bg-white/70 px-3 py-2 text-xs leading-5 text-cyan-950">
          <MessageSquareText
            className="mt-0.5 size-3.5 shrink-0 text-cyan-800"
            aria-hidden="true"
          />
          <span>{conferenceHighlightLines[0]}</span>
        </div>
      ) : null}
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

  function appendSoapFreeText(currentValue: string | undefined, nextLine: string) {
    const current = currentValue?.trim();
    if (current?.includes(nextLine)) return current;
    return [current, nextLine].filter((value): value is string => Boolean(value)).join('\n');
  }

  function handleQuickCapture(action: QuickCaptureAction) {
    if (action.target === 'subjective') {
      onChange({
        ...structuredSoap,
        subjective: {
          ...structuredSoap.subjective,
          free_text: appendSoapFreeText(structuredSoap.subjective.free_text, action.text),
        },
      });
      return;
    }

    if (action.target === 'objective') {
      onChange({
        ...structuredSoap,
        objective: {
          ...structuredSoap.objective,
          free_text: appendSoapFreeText(structuredSoap.objective.free_text, action.text),
        },
      });
      return;
    }

    if (action.target === 'assessment') {
      onChange({
        ...structuredSoap,
        assessment: {
          ...structuredSoap.assessment,
          free_text: appendSoapFreeText(structuredSoap.assessment.free_text, action.text),
        },
      });
      return;
    }

    onChange({
      ...structuredSoap,
      plan: {
        ...structuredSoap.plan,
        free_text: appendSoapFreeText(structuredSoap.plan.free_text, action.text),
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
        <VisitInformationSourceTabs
          structuredSoap={structuredSoap}
          medicationPeriod={medicationPeriod}
          prescriptionChanges={prescriptionChanges}
          previousVisitSummary={previousVisitSummary}
          conferenceContext={conferenceContext}
          onQuickCapture={handleQuickCapture}
        />
      </div>

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
