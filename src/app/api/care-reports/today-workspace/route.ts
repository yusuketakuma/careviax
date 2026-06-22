import { withAuthContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { success, validationError } from '@/lib/api/response';
import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObject, readJsonObjectString } from '@/lib/db/json';
import { dateKeySchema } from '@/lib/validations/date-key';
import { familyNameOf } from '@/lib/utils/person-name';
import { sanitizeDeliveryFailureReason } from '@/lib/reports/delivery-failure-reasons';
import { buildPatientHref } from '@/lib/patient/navigation';
import {
  BILLING_VALIDATION_LAYER_KEYS,
  readBillingValidationLayers,
  safeBillingValidationMessage,
  summarizeBillingValidationLayers,
} from '@/lib/billing/validation-layers';
import { z } from 'zod';
import type {
  ReportDraftRow,
  ReportOpenIssue,
  ReportCreatedRow,
  ReportFailedDelivery,
  ReportResolvedToday,
  ReportsTodayWorkspaceResponse,
  ReportWaitingReply,
} from '@/types/reports-today-workspace';

/**
 * new_10_report(報告・共有)用 BFF。
 * 「今日書く報告(本日訪問 → 訪問後に下書き)」「返信待ち」「今日解決した待ち」を
 * 1 リクエストで返す読み取り専用集計(docs/design-gap-analysis-new.md 10_report)。
 * - 今日書く報告: 本日の訪問予定を時刻順に、宛先(ケアマネ/医師/施設)と
 *   危険メモ(麻薬使用状況を含む)・施設一括メモ(N名分を1通に集約)付きで返す。
 * - 返信待ち: response_waiting の送付記録 + 回答待ちの疑義照会。
 * - 今日解決した待ち: 本日回答受領した照会。
 */

const WAITING_LIMIT = 5;
const RESOLVED_LIMIT = 3;
const CREATED_REPORT_LIMIT = 12;
const OPEN_ISSUE_LIMIT = 12;
const BILLING_CANDIDATE_OPEN_ISSUE_SCAN_LIMIT = OPEN_ISSUE_LIMIT * 3;
const OPEN_ISSUE_SEVERITY_RANK: Record<ReportOpenIssue['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const dateQuerySchema = z.object({
  date: dateKeySchema('日付はYYYY-MM-DD形式で指定してください').optional(),
});

/** 報告種別 → 宛先を含む既定タイトル(content.title が無いときのフォールバック) */
const REPORT_TYPE_FALLBACK_TITLES: Record<string, string> = {
  physician_report: '医師への報告',
  care_manager_report: 'ケアマネへの報告',
  facility_handoff: '施設への申し送り',
  nurse_share: '看護師への共有',
  family_share: 'ご家族への共有',
  internal_record: '社内記録',
};

const REPORT_STATUS_LABELS: Record<string, string> = {
  draft: '下書き',
  confirmed: '確認済',
  sent: '送付済',
  failed: '送付失敗',
  response_waiting: '返信待ち',
};

const DELIVERY_CHANNEL_LABELS: Record<string, string> = {
  email: 'メール',
  ses: 'メール',
  fax: 'FAX',
  phone: '電話',
  in_person: '対面',
  postal: '郵送',
  ph_os_share: 'PH-OS共有',
};

type CareTeamLinkRow = {
  role: string;
  name: string;
  is_primary: boolean;
};

/**
 * ケアチームから宛先ラベルを組み立てる。
 * 医師 + ケアマネ → 「医師(山本先生)+ケアマネ」 / ケアマネのみ → 「ケアマネ(中島様)」。
 */
function buildRecipientLabel(links: CareTeamLinkRow[]): string {
  const pickPrimary = (role: string) => {
    const candidates = links.filter((link) => link.role === role);
    return candidates.find((link) => link.is_primary) ?? candidates[0] ?? null;
  };
  const physician = pickPrimary('physician');
  const careManager = pickPrimary('care_manager');

  if (physician && careManager) {
    return `医師(${familyNameOf(physician.name)}先生)+ケアマネ`;
  }
  if (physician) {
    return `医師(${familyNameOf(physician.name)}先生)`;
  }
  if (careManager) {
    return `ケアマネ(${familyNameOf(careManager.name)}様)`;
  }
  const nurse = pickPrimary('nurse');
  if (nurse) {
    return `看護師(${familyNameOf(nurse.name)}様)`;
  }
  return '宛先未設定';
}

function readPatientIdsLength(value: unknown): number {
  return readPatientIds(value).length;
}

function readPatientIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function buildReportTitle(reportType: string, content: unknown): string {
  return (
    readJsonObjectString(readJsonObject(content), 'title') ??
    REPORT_TYPE_FALLBACK_TITLES[reportType] ??
    '報告書'
  );
}

type WorkspaceDeliveryRecord = {
  id: string;
  channel: string;
  recipient_name: string | null;
  status: string;
  sent_at: Date | null;
  failure_reason: string | null;
  retry_count: number;
  updated_at: Date;
};

type BillingCandidateIssueSource = {
  id: string;
  patient_id: string | null;
  billing_name: string;
  source_snapshot: unknown;
};

const BILLING_CANDIDATE_ISSUE_SELECT = {
  id: true,
  patient_id: true,
  billing_name: true,
  source_snapshot: true,
} as const;

const BILLING_CANDIDATE_BLOCKED_LAYER_FILTERS = BILLING_VALIDATION_LAYER_KEYS.map((layerKey) => ({
  source_snapshot: {
    path: ['validation_layers', layerKey, 'state'],
    equals: 'blocked',
  },
}));

function retryLabel(retryCount: number): string {
  return retryCount > 0 ? `再送${retryCount}回` : '再送未実施';
}

function selectLatestFailedDelivery(
  deliveryRecords: WorkspaceDeliveryRecord[],
): WorkspaceDeliveryRecord | null {
  return (
    deliveryRecords
      .filter((delivery) => delivery.status === 'failed')
      .sort((left, right) => right.updated_at.getTime() - left.updated_at.getTime())[0] ?? null
  );
}

function buildFailedDeliverySummary(
  reportId: string,
  delivery: WorkspaceDeliveryRecord,
): ReportFailedDelivery {
  return {
    delivery_record_id: delivery.id,
    recipient_label: delivery.recipient_name?.trim() || '宛先未設定',
    channel: delivery.channel,
    failure_reason: sanitizeDeliveryFailureReason(delivery.failure_reason),
    retry_count: delivery.retry_count,
    failed_at: delivery.updated_at.toISOString(),
    action: { label: '宛先確認・再送', href: `/reports/${reportId}` },
  };
}

function describeFailedDelivery(delivery: ReportFailedDelivery): string {
  const channel = DELIVERY_CHANNEL_LABELS[delivery.channel] ?? delivery.channel;
  const parts = [channel, delivery.recipient_label, retryLabel(delivery.retry_count)];
  if (delivery.failure_reason) {
    parts.push(`理由: ${delivery.failure_reason}`);
  }
  return `${parts.join(' / ')}。宛先とチャネルを確認して再送してください。`;
}

function buildReportOpenIssues(args: {
  report: {
    id: string;
    status: string;
    report_type: string;
    content: unknown;
    delivery_records: WorkspaceDeliveryRecord[];
  };
  patientLabel: string;
}): ReportOpenIssue[] {
  const content = readJsonObject(args.report.content) ?? {};
  const sourceProvenance = readJsonObject(content.source_provenance);
  const billingContext = readJsonObject(content.billing_context);
  const issues: ReportOpenIssue[] = [];
  const href = `/reports/${args.report.id}`;

  if (args.report.status === 'draft') {
    issues.push({
      kind: 'report',
      id: `${args.report.id}-draft-confirmation`,
      report_id: args.report.id,
      severity: 'critical',
      title: `${args.patientLabel} — 薬剤師確認待ち`,
      description: '下書きのため、他職種への送付とPDF出力はできません。',
      action: { label: '確認する', href },
    });
  }

  const hasDelivered = args.report.delivery_records.some(
    (delivery) => delivery.sent_at && ['sent', 'response_waiting'].includes(delivery.status),
  );
  if (args.report.status === 'confirmed' && !hasDelivered) {
    issues.push({
      kind: 'report',
      id: `${args.report.id}-not-reported`,
      report_id: args.report.id,
      severity: 'warning',
      title: `${args.patientLabel} — 他職種へ未報告`,
      description: '薬剤師確認済みですが、送信日時のある送付記録がありません。',
      action: { label: '送付へ', href },
    });
  }

  const failedDelivery = selectLatestFailedDelivery(args.report.delivery_records);
  if (args.report.status === 'failed' || failedDelivery) {
    const failedDeliverySummary = failedDelivery
      ? buildFailedDeliverySummary(args.report.id, failedDelivery)
      : null;
    issues.push({
      kind: 'report',
      id: `${args.report.id}-delivery-failed`,
      report_id: args.report.id,
      severity: 'critical',
      title: `${args.patientLabel} — 送付失敗`,
      description: failedDeliverySummary
        ? describeFailedDelivery(failedDeliverySummary)
        : '送付失敗の記録があります。宛先とチャネルを確認して再送してください。',
      failed_delivery: failedDeliverySummary,
      action: { label: '宛先確認・再送', href },
    });
  }

  const prescriptionLineIds = Array.isArray(sourceProvenance?.prescription_line_ids)
    ? sourceProvenance.prescription_line_ids
    : [];
  if (!sourceProvenance?.medication_cycle_id || prescriptionLineIds.length === 0) {
    issues.push({
      kind: 'report',
      id: `${args.report.id}-prescription-link`,
      report_id: args.report.id,
      severity: 'warning',
      title: `${args.patientLabel} — 処方リンク未確定`,
      description: '報告書の根拠に処方サイクルまたは処方行IDが不足しています。',
      action: { label: '根拠を確認', href },
    });
  }

  if (!billingContext?.payer_basis) {
    issues.push({
      kind: 'report',
      id: `${args.report.id}-billing-context`,
      report_id: args.report.id,
      severity: 'warning',
      title: `${args.patientLabel} — 保険・請求根拠未確定`,
      description: '保険種別と算定根拠が報告書contentに記録されていません。',
      action: { label: '根拠を確認', href },
    });
  }

  return issues;
}

function buildBillingCandidateOpenIssue(args: {
  candidate: BillingCandidateIssueSource;
  patientLabel: string;
  billingMonthKey: string;
}): ReportOpenIssue {
  const validationSummary = summarizeBillingValidationLayers(
    readBillingValidationLayers(args.candidate.source_snapshot),
  );
  const params = new URLSearchParams({
    billing_month: args.billingMonthKey,
    candidate_id: args.candidate.id,
  });
  if (args.candidate.patient_id) {
    params.set('patient_id', args.candidate.patient_id);
  }

  return {
    kind: 'billing_candidate',
    id: `billing-candidate-${args.candidate.id}`,
    billing_candidate_id: args.candidate.id,
    patient_id: args.candidate.patient_id,
    severity: validationSummary.state === 'blocked' ? 'critical' : 'warning',
    title: `${args.patientLabel} — 算定候補の確認待ち`,
    description: `${args.candidate.billing_name}: ${safeBillingValidationMessage(
      validationSummary,
    )}`,
    action: { label: '算定候補へ', href: `/billing/candidates?${params.toString()}` },
  };
}

function openIssueKey(issue: ReportOpenIssue) {
  return `${issue.kind}:${issue.id}`;
}

function compareOpenIssuePriority(left: ReportOpenIssue, right: ReportOpenIssue) {
  const severityDiff =
    OPEN_ISSUE_SEVERITY_RANK[left.severity] - OPEN_ISSUE_SEVERITY_RANK[right.severity];
  if (severityDiff !== 0) return severityDiff;
  return left.kind === right.kind ? 0 : left.kind === 'billing_candidate' ? -1 : 1;
}

function mergeOpenIssues(reportIssues: ReportOpenIssue[], billingIssues: ReportOpenIssue[]) {
  const sortedIssues = [...reportIssues, ...billingIssues].sort(compareOpenIssuePriority);
  const selected = sortedIssues.slice(0, OPEN_ISSUE_LIMIT);
  if (selected.length < OPEN_ISSUE_LIMIT) return selected;

  const selectedKeys = new Set(selected.map(openIssueKey));
  const selectedKinds = new Set(selected.map((issue) => issue.kind));
  const sourceKinds = [
    reportIssues.length > 0 ? 'report' : null,
    billingIssues.length > 0 ? 'billing_candidate' : null,
  ].filter((kind): kind is ReportOpenIssue['kind'] => Boolean(kind));
  const missingKind = sourceKinds.find((kind) => !selectedKinds.has(kind));
  if (!missingKind) return selected;

  const worstSelectedSeverityRank = Math.max(
    ...selected.map((issue) => OPEN_ISSUE_SEVERITY_RANK[issue.severity]),
  );
  const replacement = sortedIssues.find(
    (issue) =>
      issue.kind === missingKind &&
      !selectedKeys.has(openIssueKey(issue)) &&
      OPEN_ISSUE_SEVERITY_RANK[issue.severity] === worstSelectedSeverityRank,
  );
  if (!replacement) return selected;

  const replaceIndex = selected.findLastIndex(
    (issue) =>
      issue.kind !== missingKind &&
      OPEN_ISSUE_SEVERITY_RANK[issue.severity] === worstSelectedSeverityRank,
  );
  if (replaceIndex === -1) return selected;

  const balanced = [...selected];
  balanced[replaceIndex] = replacement;
  return balanced.sort(compareOpenIssuePriority);
}

function dedupeBillingCandidateIssues(
  candidates: BillingCandidateIssueSource[],
): BillingCandidateIssueSource[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const parsed = dateQuerySchema.safeParse({
      date: searchParams.get('date') ?? undefined,
    });
    if (!parsed.success) {
      return validationError('日付の形式が不正です', parsed.error.flatten().fieldErrors);
    }

    const now = new Date();
    const targetKey = parsed.data.date ?? localDateKey(now);
    // scheduled_date(@db.Date)比較用: 対象日のローカル日付キーを UTC 深夜レンジにする
    const today = utcDateFromLocalKey(targetKey);
    const tomorrow = addUtcDays(today, 1);
    // responded_at / sent_at(DateTime, 実時刻)比較用: 従来どおりローカル境界
    const localDayStart = new Date(`${targetKey}T00:00:00`);
    const localDayEnd = new Date(localDayStart);
    localDayEnd.setDate(localDayEnd.getDate() + 1);
    const [targetYear, targetMonth] = targetKey.split('-').map(Number);
    const monthStart = new Date(targetYear, targetMonth - 1, 1);
    const nextMonthStart = new Date(targetYear, targetMonth, 1);
    const billingMonthKey = `${targetKey.slice(0, 7)}-01`;
    const billingMonthStart = utcDateFromLocalKey(billingMonthKey);
    const canManageBilling = hasPermission(ctx.role, 'canManageBilling');

    const data = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const waitingDeliveriesPromise = tx.deliveryRecord.findMany({
          where: { org_id: ctx.orgId, status: 'response_waiting' },
          orderBy: { sent_at: 'asc' },
          take: WAITING_LIMIT,
          select: {
            id: true,
            sent_at: true,
            report: {
              select: { id: true, patient_id: true, report_type: true, content: true },
            },
          },
        });
        const waitingRequestsPromise = tx.communicationRequest.findMany({
          where: {
            org_id: ctx.orgId,
            status: { in: ['sent', 'received', 'in_progress'] },
          },
          orderBy: { requested_at: 'asc' },
          take: WAITING_LIMIT,
          select: {
            id: true,
            subject: true,
            patient_id: true,
            requested_at: true,
          },
        });
        const resolvedResponsesPromise = tx.communicationResponse.findMany({
          where: {
            org_id: ctx.orgId,
            responded_at: { gte: localDayStart, lt: localDayEnd },
          },
          orderBy: { responded_at: 'desc' },
          take: RESOLVED_LIMIT,
          select: {
            id: true,
            responded_at: true,
            request: { select: { subject: true, patient_id: true } },
          },
        });
        const recentReportsPromise = tx.careReport.findMany({
          where: { org_id: ctx.orgId },
          orderBy: { updated_at: 'desc' },
          take: CREATED_REPORT_LIMIT,
          select: {
            id: true,
            patient_id: true,
            report_type: true,
            status: true,
            content: true,
            created_at: true,
            updated_at: true,
            delivery_records: {
              orderBy: [{ updated_at: 'desc' }],
              take: 6,
              select: {
                id: true,
                channel: true,
                recipient_name: true,
                status: true,
                sent_at: true,
                failure_reason: true,
                retry_count: true,
                updated_at: true,
              },
            },
          },
        });
        const templateCountPromise = tx.template.count({
          where: { org_id: ctx.orgId, template_type: 'care_report' },
        });
        const monthlyDeliveryCountPromise = tx.deliveryRecord.count({
          where: {
            org_id: ctx.orgId,
            sent_at: { gte: monthStart, lt: nextMonthStart },
          },
        });

        const scheduleContextPromise = (async () => {
          const schedules = await tx.visitSchedule.findMany({
            where: {
              org_id: ctx.orgId,
              scheduled_date: { gte: today, lt: tomorrow },
              schedule_status: { notIn: ['cancelled', 'rescheduled'] },
            },
            orderBy: [{ time_window_start: 'asc' }, { route_order: 'asc' }],
            select: {
              id: true,
              schedule_status: true,
              time_window_start: true,
              facility_batch_id: true,
              facility_batch: {
                select: { id: true, facility_id: true, patient_ids: true },
              },
              case_: {
                select: {
                  patient: { select: { id: true, name: true } },
                  care_team_links: {
                    select: { role: true, name: true, is_primary: true },
                  },
                },
              },
              cycle: {
                select: {
                  prescription_intakes: {
                    orderBy: { created_at: 'desc' },
                    take: 1,
                    select: {
                      lines: { select: { packaging_instruction_tags: true } },
                    },
                  },
                },
              },
              visit_record: { select: { id: true, updated_at: true } },
            },
          });

          const visitRecordIds = schedules
            .map((schedule) => schedule.visit_record?.id)
            .filter((id): id is string => Boolean(id));
          const existingReportsPromise =
            visitRecordIds.length === 0
              ? Promise.resolve([])
              : tx.careReport.findMany({
                  where: {
                    org_id: ctx.orgId,
                    visit_record_id: { in: visitRecordIds },
                  },
                  select: { id: true, visit_record_id: true, status: true },
                });

          const facilityIds = [
            ...new Set(
              schedules
                .map((schedule) => schedule.facility_batch?.facility_id)
                .filter((id): id is string => Boolean(id)),
            ),
          ];
          const facilitiesPromise =
            facilityIds.length === 0
              ? Promise.resolve([])
              : tx.facility.findMany({
                  where: { id: { in: facilityIds }, org_id: ctx.orgId },
                  select: { id: true, name: true },
                });
          const [existingReports, facilities] = await Promise.all([
            existingReportsPromise,
            facilitiesPromise,
          ]);

          return { schedules, existingReports, facilities };
        })();

        const [
          { schedules, existingReports, facilities },
          waitingDeliveries,
          waitingRequests,
          resolvedResponses,
          recentReports,
          templateCount,
          monthlyDeliveryCount,
        ] = await Promise.all([
          scheduleContextPromise,
          waitingDeliveriesPromise,
          waitingRequestsPromise,
          resolvedResponsesPromise,
          recentReportsPromise,
          templateCountPromise,
          monthlyDeliveryCountPromise,
        ]);

        const reportByRecordId = new Map(
          existingReports
            .filter((report) => report.visit_record_id)
            .map((report) => [report.visit_record_id as string, report]),
        );
        const facilityNameById = new Map(
          facilities.map((facility) => [facility.id, facility.name]),
        );

        const draftRows: ReportDraftRow[] = [];
        const seenFacilityBatchIds = new Set<string>();
        for (const schedule of schedules) {
          const batch = schedule.facility_batch;
          if (batch) {
            // 施設一括訪問は 1 行に集約(「12名分を1通に集約」)
            if (seenFacilityBatchIds.has(batch.id)) continue;
            seenFacilityBatchIds.add(batch.id);
            const patientCount = readPatientIdsLength(batch.patient_ids);
            draftRows.push({
              id: `facility-${batch.id}`,
              time_start: schedule.time_window_start?.toISOString() ?? null,
              patient_label: facilityNameById.get(batch.facility_id) ?? '施設一括訪問',
              // 施設一括報告の宛先は現状データソースが無いため看護師長宛で固定表示
              recipient_label: '施設(看護師長)',
              status: 'before_visit',
              visit_record_id: null,
              visit_record_updated_at: null,
              note: patientCount > 0 ? `${patientCount}名分を1通に集約` : null,
              action: null,
            });
            continue;
          }

          const intakeLines = schedule.cycle?.prescription_intakes[0]?.lines ?? [];
          const hasNarcotic = intakeLines.some((line) =>
            line.packaging_instruction_tags.includes('narcotic'),
          );
          const existingReport = schedule.visit_record?.id
            ? (reportByRecordId.get(schedule.visit_record.id) ?? null)
            : null;
          const visitRecordId = schedule.visit_record?.id ?? null;
          const visitRecordUpdatedAt = schedule.visit_record?.updated_at?.toISOString() ?? null;
          const canGenerateDraft =
            schedule.schedule_status === 'completed' && Boolean(visitRecordId);
          draftRows.push({
            id: schedule.id,
            time_start: schedule.time_window_start?.toISOString() ?? null,
            patient_label: `${schedule.case_.patient.name} 様`,
            recipient_label: buildRecipientLabel(schedule.case_.care_team_links),
            status: existingReport
              ? existingReport.status === 'draft'
                ? 'draft_ready'
                : 'report_existing'
              : canGenerateDraft
                ? 'ready_to_generate'
                : 'before_visit',
            visit_record_id: visitRecordId,
            visit_record_updated_at: visitRecordUpdatedAt,
            note: hasNarcotic ? '麻薬使用状況を含む' : null,
            action: existingReport
              ? {
                  label: existingReport.status === 'draft' ? '→ 下書きへ' : '→ 詳細へ',
                  href: `/reports/${existingReport.id}`,
                }
              : canGenerateDraft
                ? null
                : { label: '→ 訪問へ', href: '/visits' },
          });
        }

        const waitingPatientIds = [
          ...new Set(
            [
              ...schedules.map((schedule) => schedule.case_.patient.id),
              ...schedules.flatMap((schedule) =>
                readPatientIds(schedule.facility_batch?.patient_ids),
              ),
              ...waitingDeliveries.map((delivery) => delivery.report.patient_id),
              ...waitingRequests.map((request) => request.patient_id),
              ...resolvedResponses.map((response) => response.request.patient_id),
              ...recentReports.map((report) => report.patient_id),
            ].filter((id): id is string => Boolean(id)),
          ),
        ];
        const waitingPatientsPromise =
          waitingPatientIds.length === 0
            ? Promise.resolve([])
            : tx.patient.findMany({
                where: { id: { in: waitingPatientIds }, org_id: ctx.orgId },
                select: { id: true, name: true },
              });
        const billingCandidateIssuesPromise =
          !canManageBilling || waitingPatientIds.length === 0
            ? Promise.resolve([])
            : Promise.all([
                tx.billingCandidate.findMany({
                  where: {
                    org_id: ctx.orgId,
                    patient_id: { in: waitingPatientIds },
                    billing_month: billingMonthStart,
                    status: 'candidate',
                  },
                  orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
                  take: BILLING_CANDIDATE_OPEN_ISSUE_SCAN_LIMIT,
                  select: BILLING_CANDIDATE_ISSUE_SELECT,
                }),
                tx.billingCandidate.findMany({
                  where: {
                    org_id: ctx.orgId,
                    patient_id: { in: waitingPatientIds },
                    billing_month: billingMonthStart,
                    status: 'candidate',
                    OR: BILLING_CANDIDATE_BLOCKED_LAYER_FILTERS,
                  },
                  orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
                  take: OPEN_ISSUE_LIMIT,
                  select: BILLING_CANDIDATE_ISSUE_SELECT,
                }),
              ]).then(([recentCandidates, blockedCandidates]) =>
                dedupeBillingCandidateIssues([...blockedCandidates, ...recentCandidates]),
              );
        const [waitingPatients, billingCandidateIssues] = await Promise.all([
          waitingPatientsPromise,
          billingCandidateIssuesPromise,
        ]);
        const patientNameById = new Map(
          waitingPatients.map((patient) => [patient.id, patient.name]),
        );
        const patientLabel = (patientId: string | null) => {
          if (!patientId) return null;
          const name = patientNameById.get(patientId);
          return name ? `${name} 様` : null;
        };
        const waitingDaysFrom = (since: Date | null) =>
          since ? Math.max(0, Math.floor((now.getTime() - since.getTime()) / 86_400_000)) : 0;

        const waitingReplies: ReportWaitingReply[] = [
          ...waitingDeliveries.map((delivery): ReportWaitingReply => {
            const contentTitle = readJsonObjectString(
              readJsonObject(delivery.report.content),
              'title',
            );
            const title =
              contentTitle ?? REPORT_TYPE_FALLBACK_TITLES[delivery.report.report_type] ?? '報告書';
            const patient = patientLabel(delivery.report.patient_id);
            return {
              id: `delivery-${delivery.id}`,
              kind: 'report_delivery',
              waiting_days: waitingDaysFrom(delivery.sent_at),
              title: patient ? `${patient} — ${title}` : title,
              subtitle: '再送は前回送付の記録つきで送られます',
              actions: [
                {
                  label: '再送する',
                  href: `/reports/${delivery.report.id}`,
                  kind: 'button',
                },
              ],
            };
          }),
          ...waitingRequests.map((request): ReportWaitingReply => {
            const patient = patientLabel(request.patient_id);
            return {
              id: `request-${request.id}`,
              kind: 'inquiry',
              waiting_days: waitingDaysFrom(request.requested_at),
              title: patient ? `${patient} — ${request.subject}` : request.subject,
              subtitle: null,
              actions: [
                { label: '電話で確認', href: '/communications', kind: 'button' },
                {
                  label: '→ カードへ',
                  href: request.patient_id ? buildPatientHref(request.patient_id) : '/patients',
                  kind: 'link',
                },
              ],
            };
          }),
        ]
          .sort((left, right) => right.waiting_days - left.waiting_days)
          .slice(0, WAITING_LIMIT);

        const resolvedToday: ReportResolvedToday[] = resolvedResponses.map((response) => {
          const patient = patientLabel(response.request.patient_id);
          return {
            id: response.id,
            received_at: response.responded_at.toISOString(),
            title: patient ? `${patient} — ${response.request.subject}` : response.request.subject,
            // 回答反映と「お礼不要」は運用ポリシー(14_settings)由来の説明文
            subtitle: '回答は調剤画面に自動で反映済み。返信のお礼は不要の設定です。',
            action: { label: '→ 調剤へ', href: '/dispense' },
          };
        });

        const createdReports: ReportCreatedRow[] = recentReports.map((report) => {
          const deliveryRecords = [...report.delivery_records];
          const deliveredRecords = deliveryRecords
            .filter(
              (delivery) =>
                delivery.sent_at && ['sent', 'response_waiting'].includes(delivery.status),
            )
            .sort(
              (left, right) => (right.sent_at?.getTime() ?? 0) - (left.sent_at?.getTime() ?? 0),
            );
          const lastDelivery = deliveredRecords[0] ?? null;
          const failedDelivery = selectLatestFailedDelivery(deliveryRecords);
          const failedDeliverySummary = failedDelivery
            ? buildFailedDeliverySummary(report.id, failedDelivery)
            : null;
          const patient = patientLabel(report.patient_id) ?? '患者未設定';
          return {
            id: report.id,
            patient_id: report.patient_id,
            patient_label: patient,
            report_type: report.report_type,
            report_type_label:
              REPORT_TYPE_FALLBACK_TITLES[report.report_type] ?? report.report_type,
            status: report.status,
            status_label: REPORT_STATUS_LABELS[report.status] ?? report.status,
            title: buildReportTitle(report.report_type, report.content),
            created_at: report.created_at.toISOString(),
            updated_at: report.updated_at.toISOString(),
            reported_to_professional: Boolean(lastDelivery),
            last_sent_at: lastDelivery?.sent_at?.toISOString() ?? null,
            last_recipient_label: lastDelivery?.recipient_name ?? null,
            last_channel: lastDelivery?.channel ?? null,
            failed_delivery: failedDeliverySummary,
            action: { label: '→ 詳細へ', href: `/reports/${report.id}` },
          };
        });

        const reportOpenIssues = recentReports.flatMap((report) =>
          buildReportOpenIssues({
            report,
            patientLabel: patientLabel(report.patient_id) ?? '患者未設定',
          }),
        );
        const billingOpenIssues = billingCandidateIssues.map((candidate) =>
          buildBillingCandidateOpenIssue({
            candidate,
            patientLabel: patientLabel(candidate.patient_id) ?? '患者未設定',
            billingMonthKey,
          }),
        );
        const openIssues = mergeOpenIssues(reportOpenIssues, billingOpenIssues);

        const responseData: ReportsTodayWorkspaceResponse = {
          generated_at: now.toISOString(),
          draft_rows: draftRows,
          waiting_replies: waitingReplies,
          resolved_today: resolvedToday,
          created_reports: createdReports,
          open_issues: openIssues,
          counts: {
            to_write: draftRows.length,
            waiting: waitingReplies.length,
            resolved: resolvedToday.length,
            created: createdReports.length,
            open_issues: openIssues.length,
          },
          evidence: {
            template_count: templateCount,
            monthly_delivery_count: monthlyDeliveryCount,
          },
        };

        return responseData;
      },
      { maxWaitMs: 10_000, timeoutMs: 20_000 },
    );

    return success({ data });
  },
  {
    permission: 'canReport',
    message: '報告書の閲覧権限がありません',
  },
);
