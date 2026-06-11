import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { formatPrescriptionCardNumber } from '@/lib/prescription/rx-number';
import type {
  IntakeTriageActionKey,
  IntakeTriageDuplicateNotice,
  IntakeTriageLane,
  IntakeTriageResponse,
  IntakeTriageRow,
  IntakeTriageStatusKey,
} from '@/app/(dashboard)/prescriptions/intake/intake-triage.shared';

/**
 * new_05_import(処方取込トリアージ)用 BFF。
 * 取込キュー(受信/経路/発行元/内容/自動読取/状態/行内アクション)+
 * 重複検知 + 右レール「根拠・記録」(元FAX画像/読取モデルの版/破棄ログ)を
 * 1 リクエストで返す読み取り専用集計(docs/design-gap-analysis-new.md 05_import)。
 *
 * 注: OCR 確からしさの専用フィールドは未スキーマ化のため、QR 取込
 * (QrScanDraft)の解析結果から導出できる行のみ % を返す。FAX 等は null(「—」)。
 */

const QUEUE_FETCH_LIMIT = 30;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/** PrescriptionSourceType → 3 レーン(FAX / オンライン / 持込)集約。 */
const SOURCE_TYPE_LANES: Record<string, IntakeTriageLane> = {
  fax: 'fax',
  facility_batch: 'fax',
  e_prescription: 'online',
  refill: 'online',
  paper: 'walk_in',
  qr_scan: 'walk_in',
};

type TriagePresentation = {
  status: IntakeTriageStatusKey;
  action: IntakeTriageActionKey;
};

/** MedicationCycleStatus → トリアージ状態 + 行内アクション。 */
function resolveTriagePresentation(
  overallStatus: string,
  lane: IntakeTriageLane,
): TriagePresentation {
  switch (overallStatus) {
    case 'intake_received':
      return lane === 'online'
        ? { status: 'acceptance_pending', action: 'to_dashboard' }
        : { status: 'imported', action: 'to_card' };
    case 'structuring':
      return { status: 'entry_pending', action: 'send_to_entry' };
    case 'inquiry_pending':
      return { status: 'inquiry_waiting', action: 'to_card' };
    case 'inquiry_resolved':
      return { status: 'unblock_related', action: 'send_to_entry' };
    case 'ready_to_dispense':
    case 'dispensing':
      return { status: 'entered_in_progress', action: 'to_dispensing' };
    case 'dispensed':
    case 'audit_pending':
      return { status: 'entered_in_progress', action: 'to_audit' };
    case 'audited':
    case 'setting':
      return { status: 'entered_in_progress', action: 'to_set' };
    case 'on_hold':
      return { status: 'on_hold', action: 'to_card' };
    default:
      // set_audited / visit_ready / visit_completed / reported など後工程は取込済扱い
      return { status: 'imported', action: 'to_card' };
  }
}

function resolveContentLabel(args: {
  overallStatus: string;
  prescriptionCategory: string;
}): string {
  if (args.overallStatus === 'inquiry_resolved') return '処方変更(照会回答の反映)';
  if (args.prescriptionCategory === 'emergency') return '臨時処方';
  return '定期処方';
}

function toDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toMonthDayLabel(value: Date): string {
  return `${value.getMonth() + 1}/${value.getDate()}`;
}

/** 発行日 + Rp 構成(薬剤名/用量/日数/数量)の一致シグネチャ。 */
function buildDuplicateSignature(args: {
  patientId: string;
  prescribedDate: Date;
  lines: Array<{ drug_name: string; dose: string; days: number; quantity: number | null }>;
}): string {
  const lineKey = args.lines
    .map((line) => `${line.drug_name}|${line.dose}|${line.days}|${line.quantity ?? ''}`)
    .sort()
    .join('||');
  return `${args.patientId}#${toDateKey(args.prescribedDate)}#${lineKey}`;
}

type QrConfidenceSource = {
  confirmed_intake_id: string | null;
  parse_errors: unknown;
  auto_completed: unknown;
};

/**
 * QR 解析結果からの確からしさ導出(解析エラー -5pt / 自動補完 -1pt、50〜99 に丸め)。
 * 専用 OCR スコアのスキーマ化までの暫定ヒューリスティック。
 */
function deriveQrConfidence(draft: QrConfidenceSource): number {
  const errorCount = Array.isArray(draft.parse_errors) ? draft.parse_errors.length : 0;
  const autoCompletedCount = Array.isArray(draft.auto_completed)
    ? draft.auto_completed.length
    : 0;
  return Math.min(99, Math.max(50, 100 - errorCount * 5 - autoCompletedCount));
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const url = new URL(req.url);
    const parsedQuery = querySchema.safeParse({
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!parsedQuery.success) {
      return validationError('クエリパラメータが不正です', parsedQuery.error.flatten());
    }
    const limit = parsedQuery.data.limit ?? QUEUE_FETCH_LIMIT;

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const { intakes, qrDrafts, discardCount, latestSchemaVersion } = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const intakes = await tx.prescriptionIntake.findMany({
          where: {
            org_id: ctx.orgId,
            cycle: { overall_status: { not: 'cancelled' } },
          },
          orderBy: { created_at: 'desc' },
          take: limit,
          select: {
            id: true,
            source_type: true,
            prescribed_date: true,
            prescriber_institution: true,
            prescription_category: true,
            original_document_url: true,
            created_at: true,
            cycle: {
              select: {
                id: true,
                overall_status: true,
                case_: {
                  select: {
                    patient: { select: { id: true, name: true } },
                  },
                },
              },
            },
            lines: {
              select: { drug_name: true, dose: true, days: true, quantity: true },
            },
          },
        });

        const intakeIds = intakes.map((intake) => intake.id);
        const [qrDrafts, discardCount, latestConfirmedDraft] = await Promise.all([
          intakeIds.length > 0
            ? tx.qrScanDraft.findMany({
                where: { org_id: ctx.orgId, confirmed_intake_id: { in: intakeIds } },
                select: {
                  confirmed_intake_id: true,
                  parse_errors: true,
                  auto_completed: true,
                },
              })
            : Promise.resolve([]),
          tx.qrScanDraft.count({
            where: {
              org_id: ctx.orgId,
              status: 'discarded',
              updated_at: { gte: monthStart },
            },
          }),
          tx.qrScanDraft.findFirst({
            where: { org_id: ctx.orgId },
            orderBy: { schema_version: 'desc' },
            select: { schema_version: true },
          }),
        ]);

        return {
          intakes,
          qrDrafts,
          discardCount,
          latestSchemaVersion: latestConfirmedDraft?.schema_version ?? null,
        };
      },
    );

    const confidenceByIntakeId = new Map<string, number>();
    for (const draft of qrDrafts) {
      if (draft.confirmed_intake_id) {
        confidenceByIntakeId.set(draft.confirmed_intake_id, deriveQrConfidence(draft));
      }
    }

    // 重複検知: 同一患者 × 発行日 × Rp 構成の一致。新しい方を「重複の疑い」にする。
    const earliestBySignature = new Map<string, { intakeId: string; createdAt: Date }>();
    const sortedOldFirst = [...intakes].sort(
      (left, right) => left.created_at.getTime() - right.created_at.getTime(),
    );
    const duplicateMatchedDate = new Map<string, string>();
    for (const intake of sortedOldFirst) {
      const signature = buildDuplicateSignature({
        patientId: intake.cycle.case_.patient.id,
        prescribedDate: intake.prescribed_date,
        lines: intake.lines,
      });
      const existing = earliestBySignature.get(signature);
      if (existing) {
        duplicateMatchedDate.set(intake.id, toMonthDayLabel(existing.createdAt));
      } else {
        earliestBySignature.set(signature, {
          intakeId: intake.id,
          createdAt: intake.created_at,
        });
      }
    }

    const laneCounts: Record<IntakeTriageLane, number> = { fax: 0, online: 0, walk_in: 0 };
    const duplicateNotices: IntakeTriageDuplicateNotice[] = [];

    const rows: IntakeTriageRow[] = intakes.map((intake) => {
      const lane = SOURCE_TYPE_LANES[intake.source_type] ?? 'walk_in';
      laneCounts[lane] += 1;

      const matchedDate = duplicateMatchedDate.get(intake.id) ?? null;
      const presentation: TriagePresentation = matchedDate
        ? { status: 'duplicate_suspected', action: 'compare' }
        : resolveTriagePresentation(intake.cycle.overall_status, lane);

      if (matchedDate) {
        duplicateNotices.push({
          intake_id: intake.id,
          patient_name: intake.cycle.case_.patient.name,
          lane,
          matched_date: matchedDate,
        });
      }

      const rxNumber =
        presentation.status === 'entered_in_progress'
          ? formatPrescriptionCardNumber(intake.id, toDateKey(intake.prescribed_date), 'rx_year')
          : null;

      return {
        intake_id: intake.id,
        cycle_id: intake.cycle.id,
        patient_id: intake.cycle.case_.patient.id,
        patient_name: intake.cycle.case_.patient.name,
        received_at: intake.created_at.toISOString(),
        lane,
        issuer: intake.prescriber_institution ?? null,
        content_label: resolveContentLabel({
          overallStatus: intake.cycle.overall_status,
          prescriptionCategory: intake.prescription_category,
        }),
        rx_number: rxNumber,
        auto_read_percent: confidenceByIntakeId.get(intake.id) ?? null,
        status: presentation.status,
        duplicate_of_date: matchedDate,
        action: presentation.action,
      } satisfies IntakeTriageRow;
    });

    const needsDecisionStatuses: IntakeTriageStatusKey[] = [
      'acceptance_pending',
      'duplicate_suspected',
      'on_hold',
    ];
    const responseData: IntakeTriageResponse = {
      generated_at: now.toISOString(),
      new_today_count: rows.filter((row) => new Date(row.received_at) >= todayStart).length,
      needs_decision_count: rows.filter((row) => needsDecisionStatuses.includes(row.status))
        .length,
      lane_counts: laneCounts,
      rows,
      duplicate_notices: duplicateNotices,
      evidence: {
        fax_document_count: intakes.filter(
          (intake) =>
            (SOURCE_TYPE_LANES[intake.source_type] ?? 'walk_in') === 'fax' &&
            intake.original_document_url != null,
        ).length,
        reader_model_version: latestSchemaVersion != null ? `v${latestSchemaVersion}` : null,
        discard_count_this_month: discardCount,
      },
    };

    return success({ data: responseData });
  },
  {
    permission: 'canViewDashboard',
    message: '処方取込キューの閲覧権限がありません',
  },
);
