import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { createInquiryRecordSchema } from '@/lib/validations/prescription';
import { prisma } from '@/lib/db/client';
import { toPrismaJsonInput } from '@/lib/db/json';
import type { Prisma } from '@prisma/client';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';

const DEFAULT_INQUIRY_RECORD_LIMIT = 500;
const MAX_INQUIRY_RECORD_LIMIT = 500;

function readOptionalSearchParam(searchParams: URLSearchParams, fieldName: string) {
  if (!searchParams.has(fieldName)) return { value: undefined as string | undefined };

  const value = searchParams.get(fieldName)?.trim() ?? '';
  if (!value) {
    return {
      value: undefined,
      error: `${fieldName} は空にできません`,
    };
  }

  return { value };
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const cycleIdParam = readOptionalSearchParam(searchParams, 'cycle_id');
    if (cycleIdParam.error) {
      return withSensitiveNoStore(
        validationError('検索条件が不正です', { cycle_id: [cycleIdParam.error] }),
      );
    }
    const patientIdParam = readOptionalSearchParam(searchParams, 'patient_id');
    if (patientIdParam.error) {
      return withSensitiveNoStore(
        validationError('検索条件が不正です', { patient_id: [patientIdParam.error] }),
      );
    }
    const statusParam = readOptionalSearchParam(searchParams, 'status');
    if (statusParam.error) {
      return withSensitiveNoStore(
        validationError('検索条件が不正です', { status: [statusParam.error] }),
      );
    }
    const cycleId = cycleIdParam.value;
    const patientId = patientIdParam.value;
    const status = statusParam.value;
    if (status && status !== 'unresolved' && status !== 'resolved') {
      return withSensitiveNoStore(
        validationError('検索条件が不正です', {
          status: ['status は resolved または unresolved を指定してください'],
        }),
      );
    }
    const limit = parseBoundedInteger(
      searchParams.get('limit'),
      DEFAULT_INQUIRY_RECORD_LIMIT,
      1,
      MAX_INQUIRY_RECORD_LIMIT,
    );
    const shouldLimit = searchParams.has('limit');

    const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);
    const cycleFilters: Prisma.MedicationCycleWhereInput[] = [
      ...(patientId ? [{ patient_id: patientId }] : []),
      ...(cycleAssignmentWhere ? [cycleAssignmentWhere] : []),
    ];
    const cycleWhere =
      cycleFilters.length === 0
        ? undefined
        : cycleFilters.length === 1
          ? cycleFilters[0]
          : { AND: cycleFilters };

    const where: Prisma.InquiryRecordWhereInput = {
      org_id: ctx.orgId,
      ...(cycleId ? { cycle_id: cycleId } : {}),
      ...(cycleWhere ? { cycle: cycleWhere } : {}),
      ...(status === 'unresolved' ? { OR: [{ result: null }, { result: 'pending' }] } : {}),
      ...(status === 'resolved' ? { result: { in: ['changed', 'unchanged'] } } : {}),
    };

    const records = await prisma.inquiryRecord.findMany({
      where,
      orderBy: { inquired_at: 'desc' },
      ...(shouldLimit ? { take: limit + 1 } : {}),
      select: {
        id: true,
        cycle_id: true,
        issue_id: true,
        line_id: true,
        reason: true,
        inquiry_to_physician: true,
        inquiry_content: true,
        result: true,
        proposal_origin: true,
        residual_adjustment: true,
        change_detail: true,
        inquired_at: true,
        resolved_at: true,
        created_at: true,
        updated_at: true,
        line: {
          select: {
            drug_name: true,
            line_number: true,
          },
        },
      },
    });

    const hasMore = shouldLimit && records.length > limit;
    const data = shouldLimit && hasMore ? records.slice(0, limit) : records;

    return withSensitiveNoStore(
      success({
        data,
        ...(shouldLimit ? { meta: { limit, has_more: hasMore } } : {}),
      }),
    );
  },
  {
    permission: 'canVisit',
    message: '問い合わせ記録の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createInquiryRecordSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const {
      cycle_id,
      issue_id,
      inquired_at,
      request_due_date,
      proposal_origin,
      residual_adjustment,
      ...rest
    } = parsed.data;

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);
      const cycle = await tx.medicationCycle.findFirst({
        where: {
          id: cycle_id,
          org_id: ctx.orgId,
          ...(cycleAssignmentWhere ? { AND: [cycleAssignmentWhere] } : {}),
        },
        select: {
          id: true,
          overall_status: true,
          patient_id: true,
          case_id: true,
        },
      });
      if (!cycle) return { error: 'cycle_not_found' as const };

      if (rest.line_id) {
        const line = await tx.prescriptionLine.findFirst({
          where: {
            id: rest.line_id,
            org_id: ctx.orgId,
            intake: {
              cycle_id,
            },
          },
          select: { id: true },
        });
        if (!line) return { error: 'line_not_found' as const };
      }

      if (issue_id) {
        const issue = await tx.medicationIssue.findFirst({
          where: {
            id: issue_id,
            org_id: ctx.orgId,
            patient_id: cycle.patient_id,
            OR: [{ case_id: cycle.case_id }, { case_id: null }],
          },
          select: { id: true },
        });
        if (!issue) return { error: 'issue_not_found' as const };
      }

      // Create inquiry record
      const inquiry = await tx.inquiryRecord.create({
        data: {
          org_id: ctx.orgId,
          cycle_id,
          issue_id: issue_id ?? null,
          inquired_at: new Date(inquired_at),
          proposal_origin: proposal_origin ?? 'post_inquiry',
          residual_adjustment: residual_adjustment ?? false,
          ...rest,
        },
      });

      const dueDate = request_due_date
        ? new Date(request_due_date)
        : new Date(new Date(inquired_at).getTime() + 24 * 60 * 60 * 1000);

      const communicationRequest = await tx.communicationRequest.create({
        data: {
          org_id: ctx.orgId,
          patient_id: cycle.patient_id,
          case_id: cycle.case_id,
          request_type: 'physician_inquiry',
          template_key: 'inquiry_physician',
          recipient_name: rest.inquiry_to_physician,
          recipient_role: 'physician',
          related_entity_type: 'inquiry_record',
          related_entity_id: inquiry.id,
          context_snapshot: toPrismaJsonInput({
            cycle_id,
            issue_id: issue_id ?? null,
            line_id: rest.line_id ?? null,
            reason: rest.reason,
            proposal_origin: proposal_origin ?? 'post_inquiry',
            residual_adjustment: residual_adjustment ?? false,
          }),
          status: 'sent',
          subject: `疑義照会: ${rest.reason}`,
          content: rest.inquiry_content,
          requested_by: ctx.userId,
          due_date: dueDate,
        },
      });

      await tx.communicationEvent.create({
        data: {
          org_id: ctx.orgId,
          patient_id: cycle.patient_id,
          case_id: cycle.case_id,
          event_type: 'inquiry_created',
          channel: 'phone',
          direction: 'outbound',
          counterpart_name: rest.inquiry_to_physician,
          subject: `疑義照会: ${rest.reason}`,
          content: rest.inquiry_content,
          occurred_at: new Date(inquired_at),
        },
      });

      await upsertOperationalTask(tx, {
        orgId: ctx.orgId,
        taskType: 'inquiry_workbench',
        title: '疑義照会の回答確認が必要です',
        description: `${rest.reason} / ${rest.inquiry_to_physician}`,
        priority: 'high',
        assignedTo: ctx.userId,
        dueDate,
        slaDueAt: dueDate,
        dedupeKey: `inquiry-workbench:${inquiry.id}`,
        relatedEntityType: 'inquiry_record',
        relatedEntityId: inquiry.id,
        metadata: {
          patient_id: cycle.patient_id,
          case_id: cycle.case_id,
          issue_id: issue_id ?? null,
          communication_request_id: communicationRequest.id,
        },
      });

      if (issue_id) {
        await tx.medicationIssue.update({
          where: { id: issue_id },
          data: {
            status: 'in_progress',
            resolved_by: null,
            resolved_at: null,
          },
        });
      }

      // Transition MedicationCycle status to inquiry_pending
      await tx.medicationCycle.update({
        where: { id: cycle_id },
        data: { overall_status: 'inquiry_pending' },
      });

      await tx.cycleTransitionLog.create({
        data: {
          org_id: ctx.orgId,
          cycle_id,
          from_status: cycle.overall_status,
          to_status: 'inquiry_pending',
          actor_id: ctx.userId,
          note: `inquiry_record_created:${inquiry.id}`,
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'inquiry_record_created',
        targetType: 'inquiry_record',
        targetId: inquiry.id,
        changes: {
          cycle_id,
          patient_id: cycle.patient_id,
          case_id: cycle.case_id,
          issue_id: issue_id ?? null,
          line_id: rest.line_id ?? null,
          reason: rest.reason,
          inquiry_to_physician: rest.inquiry_to_physician,
          proposal_origin: proposal_origin ?? 'post_inquiry',
          residual_adjustment: residual_adjustment ?? false,
          communication_request_id: communicationRequest.id,
          cycle_status_before: cycle.overall_status,
          cycle_status_after: 'inquiry_pending',
        },
      });

      return {
        inquiry,
        communication_request: communicationRequest,
      };
    });

    if ('error' in result) {
      if (result.error === 'cycle_not_found') {
        return validationError('指定されたサイクルが見つかりません');
      }
      if (result.error === 'issue_not_found') {
        return validationError('指定された服薬課題が見つかりません');
      }
      if (result.error === 'line_not_found') {
        return validationError('指定された処方明細が見つかりません');
      }
    }

    return success({ data: result }, 201);
  },
  {
    permission: 'canVisit',
    message: '問い合わせ記録の作成権限がありません',
  },
);
