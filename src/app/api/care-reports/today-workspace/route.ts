import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObject, readJsonObjectString } from '@/lib/db/json';
import { dateKeySchema } from '@/lib/validations/date-key';
import { z } from 'zod';
import type {
  ReportDraftRow,
  ReportOpenIssue,
  ReportCreatedRow,
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

/** 「山本 健」→「山本」。空白を含まない名前はそのまま。 */
function familyNameOf(fullName: string): string {
  return fullName.split(/[\s　]+/)[0] ?? fullName;
}

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
  return Array.isArray(value) ? value.length : 0;
}

function buildReportTitle(reportType: string, content: unknown): string {
  return (
    readJsonObjectString(readJsonObject(content), 'title') ??
    REPORT_TYPE_FALLBACK_TITLES[reportType] ??
    '報告書'
  );
}

function buildReportOpenIssues(args: {
  report: {
    id: string;
    status: string;
    report_type: string;
    content: unknown;
    delivery_records: Array<{ status: string; sent_at: Date | null }>;
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
      id: `${args.report.id}-not-reported`,
      report_id: args.report.id,
      severity: 'warning',
      title: `${args.patientLabel} — 他職種へ未報告`,
      description: '薬剤師確認済みですが、送信日時のある送付記録がありません。',
      action: { label: '送付へ', href },
    });
  }

  const hasFailedDelivery = args.report.delivery_records.some(
    (delivery) => delivery.status === 'failed',
  );
  if (args.report.status === 'failed' || hasFailedDelivery) {
    issues.push({
      id: `${args.report.id}-delivery-failed`,
      report_id: args.report.id,
      severity: 'critical',
      title: `${args.patientLabel} — 送付失敗`,
      description: '送付失敗の記録があります。宛先とチャネルを確認して再送してください。',
      action: { label: '再送確認', href },
    });
  }

  const prescriptionLineIds = Array.isArray(sourceProvenance?.prescription_line_ids)
    ? sourceProvenance.prescription_line_ids
    : [];
  if (!sourceProvenance?.medication_cycle_id || prescriptionLineIds.length === 0) {
    issues.push({
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

    const data = await withOrgContext(
      ctx.orgId,
      async (tx) => {
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
            visit_record: { select: { id: true } },
          },
        });

        const visitRecordIds = schedules
          .map((schedule) => schedule.visit_record?.id)
          .filter((id): id is string => Boolean(id));
        const draftReports =
          visitRecordIds.length === 0
            ? []
            : await tx.careReport.findMany({
                where: {
                  org_id: ctx.orgId,
                  visit_record_id: { in: visitRecordIds },
                },
                select: { id: true, visit_record_id: true },
              });
        const draftReportByRecordId = new Map(
          draftReports
            .filter((report) => report.visit_record_id)
            .map((report) => [report.visit_record_id as string, report.id]),
        );

        const facilityIds = [
          ...new Set(
            schedules
              .map((schedule) => schedule.facility_batch?.facility_id)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        const facilities =
          facilityIds.length === 0
            ? []
            : await tx.facility.findMany({
                where: { id: { in: facilityIds }, org_id: ctx.orgId },
                select: { id: true, name: true },
              });
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
              note: patientCount > 0 ? `${patientCount}名分を1通に集約` : null,
              action: null,
            });
            continue;
          }

          const intakeLines = schedule.cycle?.prescription_intakes[0]?.lines ?? [];
          const hasNarcotic = intakeLines.some((line) =>
            line.packaging_instruction_tags.includes('narcotic'),
          );
          const draftReportId = schedule.visit_record?.id
            ? (draftReportByRecordId.get(schedule.visit_record.id) ?? null)
            : null;
          const visitRecordId = schedule.visit_record?.id ?? null;
          const canGenerateDraft =
            schedule.schedule_status === 'completed' && Boolean(visitRecordId);
          draftRows.push({
            id: schedule.id,
            time_start: schedule.time_window_start?.toISOString() ?? null,
            patient_label: `${schedule.case_.patient.name} 様`,
            recipient_label: buildRecipientLabel(schedule.case_.care_team_links),
            status: draftReportId
              ? 'draft_ready'
              : canGenerateDraft
                ? 'ready_to_generate'
                : 'before_visit',
            visit_record_id: visitRecordId,
            note: hasNarcotic ? '麻薬使用状況を含む' : null,
            action: draftReportId
              ? { label: '→ 下書きへ', href: `/reports/${draftReportId}` }
              : canGenerateDraft
                ? null
                : { label: '→ 訪問へ', href: '/visits' },
          });
        }

        const [waitingDeliveries, waitingRequests, resolvedResponses] = [
          await tx.deliveryRecord.findMany({
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
          }),
          await tx.communicationRequest.findMany({
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
          }),
          await tx.communicationResponse.findMany({
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
          }),
        ];

        const recentReports = await tx.careReport.findMany({
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
              orderBy: [{ sent_at: 'desc' }, { updated_at: 'desc' }],
              take: 3,
              select: {
                id: true,
                channel: true,
                recipient_name: true,
                status: true,
                sent_at: true,
              },
            },
          },
        });

        const waitingPatientIds = [
          ...new Set(
            [
              ...waitingDeliveries.map((delivery) => delivery.report.patient_id),
              ...waitingRequests.map((request) => request.patient_id),
              ...resolvedResponses.map((response) => response.request.patient_id),
              ...recentReports.map((report) => report.patient_id),
            ].filter((id): id is string => Boolean(id)),
          ),
        ];
        const waitingPatients =
          waitingPatientIds.length === 0
            ? []
            : await tx.patient.findMany({
                where: { id: { in: waitingPatientIds }, org_id: ctx.orgId },
                select: { id: true, name: true },
              });
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
                  href: request.patient_id ? `/patients/${request.patient_id}` : '/patients',
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
            action: { label: '→ 調剤へ', href: '/dispensing' },
          };
        });

        const createdReports: ReportCreatedRow[] = recentReports.map((report) => {
          const deliveredRecords = report.delivery_records.filter(
            (delivery) =>
              delivery.sent_at && ['sent', 'response_waiting'].includes(delivery.status),
          );
          const lastDelivery = deliveredRecords[0] ?? null;
          const patient = patientLabel(report.patient_id) ?? '患者未設定';
          return {
            id: report.id,
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
            action: { label: '→ 詳細へ', href: `/reports/${report.id}` },
          };
        });

        const openIssues = recentReports
          .flatMap((report) =>
            buildReportOpenIssues({
              report,
              patientLabel: patientLabel(report.patient_id) ?? '患者未設定',
            }),
          )
          .slice(0, OPEN_ISSUE_LIMIT);

        const [templateCount, monthlyDeliveryCount] = [
          await tx.template.count({
            where: { org_id: ctx.orgId, template_type: 'care_report' },
          }),
          await tx.deliveryRecord.count({
            where: {
              org_id: ctx.orgId,
              sent_at: { gte: monthStart, lt: nextMonthStart },
            },
          }),
        ];

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
