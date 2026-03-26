import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { updateVisitScheduleProposalSchema } from '@/lib/validations/visit-schedule-proposal';
import {
  buildVisitScheduleSnapshot,
  createVisitScheduleContactLog,
} from '@/server/services/visit-schedule-audit';
import {
  evaluateVisitWorkflowGate,
  formatVisitWorkflowGateIssues,
} from '@/server/services/management-plans';
import {
  resolveOperationalTasks,
  upsertOperationalTask,
} from '@/server/services/operational-tasks';

function buildContactTaskKey(proposalId: string) {
  return `visit-contact-followup:${proposalId}`;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問候補の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateVisitScheduleProposalSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { id } = await params;

  const existing = await prisma.visitScheduleProposal.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
    },
    include: {
      case_: {
        select: {
          patient_id: true,
        },
      },
    },
  });
  if (!existing) return notFound('訪問候補が見つかりません');

  if (parsed.data.action === 'approve') {
    if (!['proposed', 'reschedule_pending'].includes(existing.proposal_status)) {
      return validationError('この候補は承認できません');
    }

    if (existing.reschedule_source_schedule_id) {
      const override = await prisma.visitScheduleOverride.findFirst({
        where: {
          org_id: ctx.orgId,
          source_schedule_id: existing.reschedule_source_schedule_id,
        },
        select: {
          approved_at: true,
        },
      });
      if (!override?.approved_at) {
        return validationError('確定済み訪問の変更は管理者承認後に進めてください');
      }
    }

    const proposal = await withOrgContext(ctx.orgId, async (tx) => {
      const updated = await tx.visitScheduleProposal.update({
        where: { id },
        data: {
          proposal_status: 'patient_contact_pending',
          approved_at: new Date(),
          approved_by: ctx.userId,
        },
      });

      await tx.auditLog.create({
        data: {
          org_id: ctx.orgId,
          actor_id: ctx.userId,
          action: 'visit_schedule_proposal_approved',
          target_type: 'VisitScheduleProposal',
          target_id: id,
          ip_address: ctx.ipAddress,
          user_agent: ctx.userAgent,
        },
      });

      return updated;
    });

    return success({ data: proposal });
  }

  if (parsed.data.action === 'reject') {
    if (!['proposed', 'patient_contact_pending', 'reschedule_pending'].includes(existing.proposal_status)) {
      return validationError('この候補は却下できません');
    }

    const proposal = await withOrgContext(ctx.orgId, async (tx) => {
      const updated = await tx.visitScheduleProposal.update({
        where: { id },
        data: {
          proposal_status: 'rejected',
          patient_contact_status: 'declined',
          patient_contacted_at: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          org_id: ctx.orgId,
          actor_id: ctx.userId,
          action: 'visit_schedule_proposal_rejected',
          target_type: 'VisitScheduleProposal',
          target_id: id,
          ip_address: ctx.ipAddress,
          user_agent: ctx.userAgent,
        },
      });

      return updated;
    });

    return success({ data: proposal });
  }

  if (parsed.data.action === 'contact_attempt') {
    const data = parsed.data;
    const outcome = data.outcome;

    if (existing.proposal_status !== 'patient_contact_pending') {
      return validationError('この候補には電話結果を記録できません');
    }

    const proposal = await withOrgContext(ctx.orgId, async (tx) => {
      await createVisitScheduleContactLog(tx, {
        orgId: ctx.orgId,
        proposalId: id,
        scheduleId: existing.finalized_schedule_id,
        patientId: existing.case_.patient_id,
        caseId: existing.case_id,
        outcome,
        contactName: data.contact_name,
        contactPhone: data.contact_phone,
        note: data.note,
        callbackDueAt: data.callback_due_at
          ? new Date(data.callback_due_at)
          : null,
        calledBy: ctx.userId,
      });

      const updated = await tx.visitScheduleProposal.update({
        where: { id },
        data: {
          proposal_status: outcome === 'declined' ? 'rejected' : 'patient_contact_pending',
          patient_contact_status: outcome,
          patient_contacted_at: new Date(),
        },
      });

      if (
        (outcome === 'attempted' || outcome === 'unreachable') &&
        data.callback_due_at
      ) {
        await upsertOperationalTask(tx, {
          orgId: ctx.orgId,
          taskType: 'visit_contact_followup',
          title: '患者への再架電が必要です',
          description: data.note ?? '訪問候補の再架電対応を行ってください。',
          priority: 'high',
          assignedTo: existing.proposed_pharmacist_id,
          dueDate: new Date(data.callback_due_at),
          slaDueAt: new Date(data.callback_due_at),
          dedupeKey: buildContactTaskKey(id),
          relatedEntityType: 'visit_schedule_proposal',
          relatedEntityId: id,
          metadata: {
            case_id: existing.case_id,
            patient_id: existing.case_.patient_id,
          },
        });
      } else if (['declined', 'confirmed'].includes(outcome)) {
        await resolveOperationalTasks(tx, {
          orgId: ctx.orgId,
          dedupeKey: buildContactTaskKey(id),
          status: 'completed',
        });
      }

      await tx.auditLog.create({
        data: {
          org_id: ctx.orgId,
          actor_id: ctx.userId,
          action: 'visit_schedule_contact_logged',
          target_type: 'VisitScheduleProposal',
          target_id: id,
          changes: {
            outcome,
            callback_due_at: data.callback_due_at ?? null,
          },
          ip_address: ctx.ipAddress,
          user_agent: ctx.userAgent,
        },
      });

      return updated;
    });

    return success({ data: proposal });
  }

  if (existing.proposal_status !== 'patient_contact_pending') {
    return validationError('この候補は承認後の電話確認を経てから確定してください');
  }
  if (existing.patient_contact_status !== 'confirmed') {
    return validationError('患者への電話確認結果を「確認済み」にしてから日時確定してください');
  }

  const result = await withOrgContext(ctx.orgId, async (tx) => {
    const finalizedAt = new Date();

    const gate = await evaluateVisitWorkflowGate(tx, {
      orgId: ctx.orgId,
      patientId: existing.case_.patient_id,
      caseId: existing.case_id,
      asOf: existing.proposed_date,
    });
    if (!gate.ok) {
      return {
        error: 'workflow_gate' as const,
        issues: gate.issues,
      };
    }

    if (existing.finalized_schedule_id) {
      const schedule = await tx.visitSchedule.findFirst({
        where: {
          id: existing.finalized_schedule_id,
          org_id: ctx.orgId,
        },
      });
      return {
        proposal: existing,
        schedule,
      };
    }

    if (existing.reschedule_source_schedule_id) {
      const override = await tx.visitScheduleOverride.findFirst({
        where: {
          source_schedule_id: existing.reschedule_source_schedule_id,
          org_id: ctx.orgId,
        },
        select: {
          approved_at: true,
        },
      });
      if (!override?.approved_at) {
        return {
          error: 'override_not_approved' as const,
        };
      }
    }

    await tx.visitSchedule.updateMany({
      where: {
        org_id: ctx.orgId,
        pharmacist_id: existing.proposed_pharmacist_id,
        scheduled_date: existing.proposed_date,
        route_order: {
          gte: existing.route_order ?? 1,
        },
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
      },
      data: {
        route_order: {
          increment: 1,
        },
      },
    });

    const schedule = await tx.visitSchedule.create({
      data: {
        org_id: ctx.orgId,
        case_id: existing.case_id,
        cycle_id: existing.cycle_id ?? null,
        site_id: existing.site_id ?? null,
        visit_type: existing.visit_type,
        priority: existing.priority,
        schedule_status: 'planned',
        scheduled_date: existing.proposed_date,
        time_window_start: existing.time_window_start,
        time_window_end: existing.time_window_end,
        pharmacist_id: existing.proposed_pharmacist_id,
        assignment_mode: existing.assignment_mode,
        escalation_reason: existing.escalation_reason,
        route_order: existing.route_order ?? 1,
        medication_end_date: existing.medication_end_date,
        visit_deadline_date: existing.visit_deadline_date,
        confirmed_at: finalizedAt,
        confirmed_by: ctx.userId,
      },
    });

    await tx.visitScheduleContactLog.updateMany({
      where: {
        org_id: ctx.orgId,
        proposal_id: id,
        schedule_id: null,
      },
      data: {
        schedule_id: schedule.id,
      },
    });

    await tx.visitScheduleProposal.updateMany({
      where: {
        org_id: ctx.orgId,
        case_id: existing.case_id,
        id: { not: id },
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        ...(existing.reschedule_source_schedule_id
          ? { reschedule_source_schedule_id: existing.reschedule_source_schedule_id }
          : { reschedule_source_schedule_id: null }),
      },
      data: {
        proposal_status: 'superseded',
      },
    });

    const proposal = await tx.visitScheduleProposal.update({
      where: { id },
      data: {
        proposal_status: 'confirmed',
        patient_contact_status: 'confirmed',
        patient_contacted_at: finalizedAt,
        confirmed_at: finalizedAt,
        confirmed_by: ctx.userId,
        finalized_schedule_id: schedule.id,
      },
    });

    if (existing.reschedule_source_schedule_id) {
      await tx.visitScheduleOverride.update({
        where: {
          source_schedule_id: existing.reschedule_source_schedule_id,
        },
        data: {
          status: 'completed',
          replacement_schedule_id: schedule.id,
          after_snapshot: buildVisitScheduleSnapshot(schedule),
        },
      });
    }

    await tx.auditLog.create({
      data: {
        org_id: ctx.orgId,
        actor_id: ctx.userId,
        action: 'visit_schedule_confirmed',
        target_type: 'VisitSchedule',
        target_id: schedule.id,
        changes: {
          proposal_id: id,
          reschedule_source_schedule_id: existing.reschedule_source_schedule_id,
        },
        ip_address: ctx.ipAddress,
        user_agent: ctx.userAgent,
      },
    });

    await resolveOperationalTasks(tx, {
      orgId: ctx.orgId,
      dedupeKey: buildContactTaskKey(id),
      status: 'completed',
    });

    return { proposal, schedule };
  });

  if ('error' in result) {
    if (result.error === 'workflow_gate') {
      return validationError(formatVisitWorkflowGateIssues(result.issues));
    }
    if (result.error === 'override_not_approved') {
      return validationError('確定済み訪問の変更は承認後に新候補を確定してください');
    }
  }

  return success({ data: result });
}
