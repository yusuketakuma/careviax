import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { createInquiryRecordSchema } from '@/lib/validations/prescription';
import { prisma } from '@/lib/db/client';
import type { Prisma } from '@prisma/client';
import { upsertOperationalTask } from '@/server/services/operational-tasks';

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const cycleId = searchParams.get('cycle_id') ?? undefined;
    const patientId = searchParams.get('patient_id') ?? undefined;
    const status = searchParams.get('status') ?? undefined;

    const where = {
      org_id: req.orgId,
      ...(cycleId ? { cycle_id: cycleId } : {}),
      ...(patientId
        ? {
            cycle: {
              patient_id: patientId,
            },
          }
        : {}),
      ...(status === 'unresolved' ? { OR: [{ result: null }, { result: 'pending' }] } : {}),
      ...(status === 'resolved' ? { result: { in: ['changed', 'unchanged'] } } : {}),
    };

    const records = await prisma.inquiryRecord.findMany({
      where,
      orderBy: { inquired_at: 'desc' },
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

    return success({ data: records });
  },
  {
    permission: 'canVisit',
    message: '問い合わせ記録の閲覧権限がありません',
  },
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = createInquiryRecordSchema.safeParse(body);
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

    const result = await withOrgContext(req.orgId, async (tx) => {
      // Verify cycle belongs to this org
      const cycle = await tx.medicationCycle.findFirst({
        where: { id: cycle_id, org_id: req.orgId },
        select: {
          id: true,
          overall_status: true,
          patient_id: true,
          case_id: true,
        },
      });
      if (!cycle) return { error: 'cycle_not_found' as const };

      if (issue_id) {
        const issue = await tx.medicationIssue.findFirst({
          where: {
            id: issue_id,
            org_id: req.orgId,
            patient_id: cycle.patient_id,
          },
          select: { id: true },
        });
        if (!issue) return { error: 'issue_not_found' as const };
      }

      // Create inquiry record
      const inquiry = await tx.inquiryRecord.create({
        data: {
          org_id: req.orgId,
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
          org_id: req.orgId,
          patient_id: cycle.patient_id,
          case_id: cycle.case_id,
          request_type: 'physician_inquiry',
          template_key: 'inquiry_physician',
          recipient_name: rest.inquiry_to_physician,
          recipient_role: 'physician',
          related_entity_type: 'inquiry_record',
          related_entity_id: inquiry.id,
          context_snapshot: {
            cycle_id,
            issue_id: issue_id ?? null,
            line_id: rest.line_id ?? null,
            reason: rest.reason,
            proposal_origin: proposal_origin ?? 'post_inquiry',
            residual_adjustment: residual_adjustment ?? false,
          } as Prisma.InputJsonValue,
          status: 'sent',
          subject: `疑義照会: ${rest.reason}`,
          content: rest.inquiry_content,
          requested_by: req.userId,
          due_date: dueDate,
        },
      });

      await tx.communicationEvent.create({
        data: {
          org_id: req.orgId,
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
        orgId: req.orgId,
        taskType: 'inquiry_workbench',
        title: '疑義照会の回答確認が必要です',
        description: `${rest.reason} / ${rest.inquiry_to_physician}`,
        priority: 'high',
        assignedTo: req.userId,
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
    }

    return success({ data: result }, 201);
  },
  {
    permission: 'canVisit',
    message: '問い合わせ記録の作成権限がありません',
  },
);
