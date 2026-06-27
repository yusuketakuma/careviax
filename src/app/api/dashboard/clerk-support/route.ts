import { withAuthContext } from '@/lib/auth/context';
import { internalError, success } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { formatNullableDateKey } from '@/lib/date-key';
import { buildScheduleProposalDetailHref } from '@/lib/schedules/navigation';
import type { ClerkSupportResponse, ClerkSupportTask } from '@/types/clerk-support';

/**
 * p0_25「事務サポート」用 BFF。
 * 事務でできる作業(取込・送付先・日程確認・文書記録・返信待ち)の件数と
 * 着手リストを 1 リクエストで返す読み取り専用集計。
 * 薬剤師の判断が必要な境界(処方内容・薬の変更理由など)は consult_items として掲示する。
 */

const CLERK_TASK_LIMIT = 6;

/** 文書送付の主対象(FAX・メール未登録を「送付先未設定」として数える役割) */
const DOCUMENT_CHANNEL_ROLES = ['physician', 'nurse', 'care_manager'];

/** 事務では判断しない境界(p0_25 右カードの掲示内容) */
const PHARMACIST_CONSULT_ITEMS = [
  '処方内容の判断',
  '薬の変更理由',
  '服薬指導の内容',
  '算定できるかの判断',
];

const authenticatedGET = withAuthContext(
  async (_req, ctx) => {
    const now = new Date();

    const [
      intakePending,
      deliveryTargetMissing,
      scheduleConfirmation,
      documentDrafts,
      replyPending,
      pharmacistReview,
      intakeCycles,
      contactProposals,
    ] = await Promise.all([
      prisma.medicationCycle.count({
        where: {
          org_id: ctx.orgId,
          overall_status: { in: ['intake_received', 'structuring'] },
        },
      }),
      prisma.careTeamLink.count({
        where: {
          org_id: ctx.orgId,
          role: { in: DOCUMENT_CHANNEL_ROLES },
          AND: [{ OR: [{ fax: null }, { fax: '' }] }, { OR: [{ email: null }, { email: '' }] }],
          case_: { status: 'active' },
        },
      }),
      prisma.visitScheduleProposal.count({
        where: { org_id: ctx.orgId, proposal_status: 'patient_contact_pending' },
      }),
      prisma.careReport.count({
        where: { org_id: ctx.orgId, status: 'draft' },
      }),
      prisma.careReport.count({
        where: { org_id: ctx.orgId, status: 'response_waiting' },
      }),
      prisma.workflowException.count({
        where: { org_id: ctx.orgId, status: 'open' },
      }),
      prisma.medicationCycle.findMany({
        where: {
          org_id: ctx.orgId,
          overall_status: { in: ['intake_received', 'structuring'] },
        },
        orderBy: { updated_at: 'asc' },
        take: 3,
        select: {
          id: true,
          case_: { select: { patient: { select: { name: true } } } },
        },
      }),
      prisma.visitScheduleProposal.findMany({
        where: { org_id: ctx.orgId, proposal_status: 'patient_contact_pending' },
        orderBy: [{ proposed_date: 'asc' }, { time_window_start: 'asc' }],
        take: 3,
        select: {
          id: true,
          proposed_date: true,
          case_: { select: { patient: { select: { name: true } } } },
        },
      }),
    ]);

    const tasks: ClerkSupportTask[] = [
      ...intakeCycles.map(
        (cycle): ClerkSupportTask => ({
          id: `intake-${cycle.id}`,
          kind_label: '処方受付',
          patient_name: cycle.case_.patient.name,
          next_action: '取込内容を確認して入力へ送る',
          due_label: null,
          href: '/prescriptions/intake',
        }),
      ),
      ...contactProposals.map(
        (proposal): ClerkSupportTask => ({
          id: `proposal-${proposal.id}`,
          kind_label: '日程確認',
          patient_name: proposal.case_.patient.name,
          next_action: '候補日時を電話で確認',
          due_label: formatNullableDateKey(proposal.proposed_date),
          href: buildScheduleProposalDetailHref(proposal.id),
        }),
      ),
    ].slice(0, CLERK_TASK_LIMIT);

    const responseData: ClerkSupportResponse = {
      generated_at: now.toISOString(),
      kpis: {
        intake_pending: intakePending,
        delivery_target_missing: deliveryTargetMissing,
        schedule_confirmation: scheduleConfirmation,
        document_drafts: documentDrafts,
        reply_pending: replyPending,
        pharmacist_review: pharmacistReview,
      },
      tasks,
      consult_items: PHARMACIST_CONSULT_ITEMS,
    };

    return success({ data: responseData });
  },
  {
    permission: 'canViewDashboard',
    message: 'ダッシュボードの閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch {
    return withSensitiveNoStore(internalError());
  }
};
