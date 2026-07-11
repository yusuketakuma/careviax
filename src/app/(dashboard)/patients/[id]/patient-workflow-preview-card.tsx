'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { z } from 'zod';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/loading';
import { PageSection } from '@/components/layout/page-section';
import { ActionRail } from '@/components/ui/action-rail';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { buildPatientWorkflowPreviewApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import { timeIsoToString } from '@/lib/visits/time-of-day';
import type { PatientWorkflowPreviewSnapshot } from './patient-detail.types';

const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];
const nullableTextSchema = z.string().nullable();
const nullableDateTimeSchema = z.string().datetime().nullable();

const reportTargetSchema = z
  .object({
    key: z.enum(['physician_report', 'care_manager_report', 'nurse_share', 'mcs']),
    label: z.string().min(1),
    available: z.boolean(),
    source: z.enum(['care_team', 'requester', 'intake', 'patient_setting', 'missing']),
    recipient_name: nullableTextSchema,
    recipient_organization: nullableTextSchema,
    contact: nullableTextSchema,
    status: nullableTextSchema.optional(),
  })
  .strict()
  .superRefine((target, context) => {
    if (target.available === (target.source === 'missing')) {
      context.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'availability/source mismatch',
      });
    }
  });

const reportTargetsSchema = z
  .array(reportTargetSchema)
  .length(4)
  .superRefine((targets, context) => {
    if (new Set(targets.map((target) => target.key)).size !== targets.length) {
      context.addIssue({ code: 'custom', message: 'duplicate report target' });
    }
  });

const communicationTargetSchema = z
  .object({
    key: z.enum(['family', 'facility', 'nurse', 'care_manager', 'mcs']),
    recipientRole: z.enum(['family', 'facility', 'visiting_nurse', 'care_manager', 'mcs']),
    recipientName: z.string().min(1),
    contact: nullableTextSchema,
    priority_order: z.number().int().positive(),
  })
  .strict();

const communicationTargetsSchema = z
  .array(communicationTargetSchema)
  .max(5)
  .superRefine((targets, context) => {
    if (new Set(targets.map((target) => target.key)).size !== targets.length) {
      context.addIssue({ code: 'custom', message: 'duplicate communication target' });
    }
    targets.forEach((target, index) => {
      if (target.priority_order !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: [index, 'priority_order'],
          message: 'priority order mismatch',
        });
      }
    });
  });

const patientWorkflowPreviewResponseSchema = z
  .object({
    data: z
      .object({
        visit_preparation: z
          .object({
            onboarding_readiness: z
              .object({
                consent_obtained: z.boolean(),
                emergency_contact_set: z.boolean(),
                primary_physician_set: z.boolean(),
                management_plan_approved: z.boolean(),
              })
              .strict(),
            scheduling_preview: z
              .object({
                preferred_weekdays: z.array(z.number().int().min(0).max(6)).max(7),
                preferred_time_from: nullableDateTimeSchema,
                preferred_time_to: nullableDateTimeSchema,
                phone_contact_from: nullableDateTimeSchema,
                phone_contact_to: nullableDateTimeSchema,
                facility_time_from: nullableDateTimeSchema,
                facility_time_to: nullableDateTimeSchema,
                family_presence_required: z.boolean(),
                visit_buffer_minutes: z.number().int().nonnegative().nullable(),
                preferred_contact_name: nullableTextSchema,
                preferred_contact_phone: nullableTextSchema,
                visit_before_contact_required: z.boolean(),
                first_visit_preferred_date: nullableDateTimeSchema,
                first_visit_time_slot: nullableTextSchema,
                first_visit_time_note: nullableTextSchema,
                parking_available: z.boolean().nullable(),
                primary_contact_preference: nullableTextSchema,
                mcs_linked: z.boolean(),
              })
              .strict(),
            baseline_context: z
              .object({
                primary_disease: nullableTextSchema,
                care_level: nullableTextSchema,
                adl_level: nullableTextSchema,
                dementia_level: nullableTextSchema,
                money_management: nullableTextSchema,
                family_key_person: nullableTextSchema,
                medication_support_methods: z.array(z.string()),
                special_medical_procedures: z.array(z.string()),
                infection_isolation: nullableTextSchema,
                narcotics_base: z.boolean().nullable(),
                narcotics_rescue: z.boolean().nullable(),
                residual_medication_status: nullableTextSchema,
              })
              .strict(),
            latest_labs: z.array(
              z
                .object({
                  analyte_code: z.string().min(1),
                  measured_at: z.string().datetime(),
                  value_numeric: z.number().nullable(),
                  unit: nullableTextSchema,
                  abnormal_flag: nullableTextSchema,
                })
                .strict(),
            ),
            blockers: z.array(z.string().min(1)),
          })
          .strict(),
        report_targets: reportTargetsSchema,
        communication_priority: z
          .object({
            preferred_contact_method: nullableTextSchema,
            effective_channel: z.enum(['phone', 'fax', 'email', 'collaboration', 'in_person']),
            visit_before_contact_required: z.boolean(),
            pharmacy_decision_due_date: nullableDateTimeSchema,
            targets: communicationTargetsSchema,
            warnings: z.array(z.string().min(1)),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

function labelList(values: string[]) {
  return values.length > 0 ? values.join(' / ') : '—';
}

function timeValue(value: string | null) {
  return timeIsoToString(value) ?? '—';
}

const reportTargetSourceLabels: Record<
  PatientWorkflowPreviewSnapshot['report_targets'][number]['source'],
  string
> = {
  care_team: '患者情報',
  requester: '依頼元',
  intake: '受付情報',
  patient_setting: '患者設定',
  missing: '未設定',
};

function PatientWorkflowPreviewLoadingCard() {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <h2 className="font-heading text-base leading-snug font-medium">
          訪問・報告・連携プレビュー
        </h2>
      </CardHeader>
      <CardContent
        className="grid gap-4 xl:grid-cols-3"
        role="status"
        aria-label="ワークフロープレビューを読み込み中"
      >
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="space-y-3 rounded-lg border border-border/70 bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
        <span className="sr-only">ワークフロープレビューを読み込んでいます。</span>
      </CardContent>
    </Card>
  );
}

export function PatientWorkflowPreviewCard({ patientId }: { patientId: string }) {
  const orgId = useOrgId();
  const previewQuery = useQuery<PatientWorkflowPreviewSnapshot>({
    queryKey: ['patient-workflow-preview', patientId, orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const response = await fetch(buildPatientWorkflowPreviewApiPath(patientId), {
        headers: buildOrgHeaders(orgId ?? ''),
      });
      const payload = await readApiJson<{ data: PatientWorkflowPreviewSnapshot }>(response, {
        fallbackMessage: 'ワークフロープレビューの取得に失敗しました',
        schema: patientWorkflowPreviewResponseSchema,
      });
      return payload.data;
    },
  });

  if (!orgId || previewQuery.isLoading) {
    return <PatientWorkflowPreviewLoadingCard />;
  }

  if (previewQuery.error instanceof Error || !previewQuery.data) {
    return (
      <Card className="lg:col-span-2">
        <CardHeader>
          <h2 className="font-heading text-base leading-snug font-medium">
            訪問・報告・連携プレビュー
          </h2>
        </CardHeader>
        <CardContent>
          <p role="status" aria-live="polite" className="text-sm text-destructive">
            ワークフロープレビューの取得に失敗しました。再試行してください。
          </p>
        </CardContent>
      </Card>
    );
  }

  const preview = previewQuery.data;

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-base leading-snug font-medium">
            訪問・報告・連携プレビュー
          </h2>
          <ActionRail>
            <Link
              href={buildPatientHref(patientId, '/edit')}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              患者編集
            </Link>
            <Link
              href={buildPatientHref(patientId, '/consent')}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              同意記録
            </Link>
            <Link
              href={buildPatientHref(patientId, '/mcs')}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              MCS連携
            </Link>
          </ActionRail>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-3">
        <PageSection
          title="訪問準備プレビュー"
          headingLevel={3}
          tone="subtle"
          contentClassName="space-y-3"
          actions={
            <Badge
              variant={preview.visit_preparation.blockers.length === 0 ? 'default' : 'secondary'}
            >
              {preview.visit_preparation.blockers.length === 0 ? '準備良好' : '要確認'}
            </Badge>
          }
        >
          <dl className="space-y-2 text-sm">
            <div className="grid gap-1 sm:grid-cols-[130px_minmax(0,1fr)]">
              <dt className="text-muted-foreground">希望曜日</dt>
              <dd>
                {preview.visit_preparation.scheduling_preview.preferred_weekdays.length > 0
                  ? preview.visit_preparation.scheduling_preview.preferred_weekdays
                      .map((value) => weekdayLabels[value] ?? String(value))
                      .join(' / ')
                  : '—'}
              </dd>
            </div>
            <div className="grid gap-1 sm:grid-cols-[130px_minmax(0,1fr)]">
              <dt className="text-muted-foreground">訪問時間帯</dt>
              <dd>
                {timeValue(preview.visit_preparation.scheduling_preview.preferred_time_from)} -{' '}
                {timeValue(preview.visit_preparation.scheduling_preview.preferred_time_to)}
              </dd>
            </div>
            <div className="grid gap-1 sm:grid-cols-[130px_minmax(0,1fr)]">
              <dt className="text-muted-foreground">優先連絡先</dt>
              <dd>
                {labelList(
                  [
                    preview.visit_preparation.scheduling_preview.preferred_contact_name ?? '',
                    preview.visit_preparation.scheduling_preview.preferred_contact_phone ?? '',
                  ].filter(Boolean),
                )}
              </dd>
            </div>
            <div className="grid gap-1 sm:grid-cols-[130px_minmax(0,1fr)]">
              <dt className="text-muted-foreground">介護度 / ADL</dt>
              <dd>
                {labelList(
                  [
                    preview.visit_preparation.baseline_context.care_level ?? '',
                    preview.visit_preparation.baseline_context.adl_level ?? '',
                    preview.visit_preparation.baseline_context.dementia_level ?? '',
                  ].filter(Boolean),
                )}
              </dd>
            </div>
            <div className="grid gap-1 sm:grid-cols-[130px_minmax(0,1fr)]">
              <dt className="text-muted-foreground">特別処置</dt>
              <dd>
                {labelList(preview.visit_preparation.baseline_context.special_medical_procedures)}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">
              同意 {preview.visit_preparation.onboarding_readiness.consent_obtained ? '済' : '未'}
            </Badge>
            <Badge variant="outline">
              緊急連絡先{' '}
              {preview.visit_preparation.onboarding_readiness.emergency_contact_set ? '済' : '未'}
            </Badge>
            <Badge variant="outline">
              計画書{' '}
              {preview.visit_preparation.onboarding_readiness.management_plan_approved
                ? '済'
                : '未'}
            </Badge>
          </div>
          {preview.visit_preparation.blockers.length > 0 ? (
            <div className="space-y-2 rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card p-3 text-sm">
              {preview.visit_preparation.blockers.map((item) => (
                <p key={item} className="text-state-confirm">
                  {item}
                </p>
              ))}
            </div>
          ) : null}
        </PageSection>

        <PageSection
          title="報告先マトリクス"
          headingLevel={3}
          tone="subtle"
          contentClassName="space-y-3"
          actions={
            <Link
              href={buildPatientHref(patientId, '/share')}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              共有設定
            </Link>
          }
        >
          <div className="space-y-3">
            {preview.report_targets.map((target) => (
              <div
                key={target.key}
                className="rounded-lg border border-border/60 bg-background p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-foreground">{target.label}</p>
                  <Badge variant={target.available ? 'default' : 'outline'}>
                    {target.available ? '有効' : '未解決'}
                  </Badge>
                  <Badge variant="outline">{reportTargetSourceLabels[target.source]}</Badge>
                </div>
                <p className="mt-2 text-foreground">
                  {labelList(
                    [
                      target.recipient_name ?? '',
                      target.recipient_organization ?? '',
                      target.contact ?? '',
                    ].filter(Boolean),
                  )}
                </p>
                {'status' in target && target.status ? (
                  <p className="mt-1 text-xs text-muted-foreground">同期状態 {target.status}</p>
                ) : null}
              </div>
            ))}
          </div>
        </PageSection>

        <PageSection
          title="連携優先順位プレビュー"
          headingLevel={3}
          tone="subtle"
          contentClassName="space-y-3"
          actions={
            <Link
              href={buildPatientHref(patientId, '/mcs')}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              連携先確認
            </Link>
          }
        >
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">
              優先手段 {preview.communication_priority.preferred_contact_method ?? '未設定'}
            </Badge>
            <Badge variant="outline">
              実効チャネル {preview.communication_priority.effective_channel}
            </Badge>
            {preview.communication_priority.visit_before_contact_required ? (
              <Badge variant="secondary">事前連絡必須</Badge>
            ) : null}
          </div>
          <div className="space-y-2">
            {preview.communication_priority.targets.map((target) => (
              <div
                key={target.key}
                className="rounded-lg border border-border/60 bg-background p-3 text-sm"
              >
                <p className="font-medium text-foreground">
                  {target.priority_order}. {target.recipientName}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {target.recipientRole}
                  {target.contact ? ` / ${target.contact}` : ''}
                </p>
              </div>
            ))}
            {preview.communication_priority.targets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                優先順位を解決できる連携先がありません。
              </p>
            ) : null}
          </div>
          {preview.communication_priority.warnings.length > 0 ? (
            <div className="space-y-2 rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card p-3 text-sm">
              {preview.communication_priority.warnings.map((warning) => (
                <p key={warning} className="text-state-confirm">
                  {warning}
                </p>
              ))}
            </div>
          ) : null}
        </PageSection>
      </CardContent>
    </Card>
  );
}
