import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { z } from 'zod';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const now = new Date();
  const tasks = await prisma.dispenseTask.findMany({
    where: {
      org_id: req.orgId,
      status: 'completed',
    },
    orderBy: [{ priority: 'asc' }, { updated_at: 'asc' }],
    include: {
      audits: {
        orderBy: { audited_at: 'desc' },
        take: 1,
        select: {
          id: true,
          result: true,
          audited_at: true,
        },
      },
      results: {
        select: {
          id: true,
          actual_drug_name: true,
          actual_quantity: true,
          actual_unit: true,
          carry_type: true,
          dispensed_at: true,
          line: {
            select: {
              id: true,
              line_number: true,
              drug_name: true,
              drug_code: true,
              dosage_form: true,
              dose: true,
              frequency: true,
              days: true,
              quantity: true,
              unit: true,
              is_generic: true,
              packaging_instructions: true,
              notes: true,
            },
          },
        },
      },
      cycle: {
        select: {
          id: true,
          patient_id: true,
          overall_status: true,
          case_: {
            select: {
              id: true,
              patient: {
                select: {
                  id: true,
                  name: true,
                  name_kana: true,
                  residences: {
                    where: { is_primary: true },
                    take: 1,
                    select: {
                      building_id: true,
                      address: true,
                    },
                  },
                },
              },
            },
          },
          prescription_intakes: {
            orderBy: { created_at: 'desc' },
            take: 1,
            select: {
              id: true,
              prescribed_date: true,
              prescriber_name: true,
              prescriber_institution: true,
              original_document_url: true,
              lines: {
                select: {
                  id: true,
                  line_number: true,
                  drug_name: true,
                  drug_code: true,
                  dosage_form: true,
                  dose: true,
                  frequency: true,
                  days: true,
                  quantity: true,
                  unit: true,
                  is_generic: true,
                  packaging_instructions: true,
                  notes: true,
                },
              },
            },
          },
        },
      },
    },
  });

  // Sort by priority weight
  const priorityWeight: Record<string, number> = {
    emergency: 0,
    urgent: 1,
    normal: 2,
  };
  const sorted = [...tasks].sort((a, b) => {
    const wa = priorityWeight[a.priority] ?? 2;
    const wb = priorityWeight[b.priority] ?? 2;
    if (wa !== wb) return wa - wb;
    if (a.due_date && b.due_date) return a.due_date.getTime() - b.due_date.getTime();
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return a.updated_at.getTime() - b.updated_at.getTime();
  });

  const visible = sorted.filter((task) => {
    const latestAudit = task.audits[0] ?? null;
    return latestAudit == null || latestAudit.result === 'hold';
  });

  return success({
    data: visible.map((task) => {
      const residence = task.cycle.case_.patient.residences[0] ?? null;
      const facilityLabel = residence?.building_id ?? residence?.address ?? null;
      const isOverdue = task.due_date != null && task.due_date.getTime() < now.getTime();

      return {
        ...task,
        facility_label: facilityLabel,
        is_overdue: isOverdue,
      };
    }),
  });
}, {
  permission: 'canAuditDispense',
  message: '調剤鑑査の閲覧権限がありません',
});

const createDispenseAuditSchema = z.object({
  task_id: z.string().min(1),
  result: z.enum(['approved', 'rejected', 'hold', 'emergency_approved']),
  reject_reason: z.string().optional(),
  reject_detail: z.string().optional(),
  external_audit: z
    .object({
      adapter: z.string().min(1),
      external_id: z.string().min(1),
      image_check_result: z.enum(['pass', 'warning', 'fail']),
      image_check_summary: z.string().optional(),
    })
    .optional(),
});

function mergeRejectDetail(args: {
  rejectDetail?: string;
  externalAudit?: {
    adapter: string;
    external_id: string;
    image_check_result: 'pass' | 'warning' | 'fail';
    image_check_summary?: string;
  };
}) {
  if (!args.externalAudit) {
    return args.rejectDetail ?? null;
  }

  const externalSummary = [
    `adapter=${args.externalAudit.adapter}`,
    `external_id=${args.externalAudit.external_id}`,
    `image_check=${args.externalAudit.image_check_result}`,
    args.externalAudit.image_check_summary?.trim()
      ? `summary=${args.externalAudit.image_check_summary.trim()}`
      : null,
  ]
    .filter(Boolean)
    .join(' / ');

  return [args.rejectDetail?.trim(), `[external_audit] ${externalSummary}`]
    .filter(Boolean)
    .join('\n');
}

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createDispenseAuditSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { task_id, result, reject_reason, reject_detail, external_audit } = parsed.data;

  if (result === 'rejected' && !reject_reason) {
    return validationError('差戻し時は理由コードが必須です');
  }
  if (result === 'emergency_approved' && !reject_detail?.trim()) {
    return validationError('緊急例外承認時は理由の記録が必須です');
  }

  const auditResult = await withOrgContext(req.orgId, async (tx) => {
    // Verify task belongs to this org
    const task = await tx.dispenseTask.findFirst({
      where: { id: task_id, org_id: req.orgId },
      select: {
        id: true,
        cycle_id: true,
        assigned_to: true,
        due_date: true,
        priority: true,
        cycle: {
          select: {
            patient_id: true,
            set_plans: {
              select: {
                id: true,
              },
              take: 1,
            },
            case_: {
              select: {
                primary_pharmacist_id: true,
                patient: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!task) return null;

    if (result === 'emergency_approved') {
      const adminMembership = await tx.membership.findFirst({
        where: {
          org_id: req.orgId,
          user_id: req.userId,
          is_active: true,
          role: { in: ['owner', 'admin'] as never[] },
        },
        select: {
          id: true,
        },
      });
      if (!adminMembership) {
        return { error: '緊急例外承認は管理者のみ実行できます' } as const;
      }
    }

    const now = new Date();

    // Create DispenseAudit
    const audit = await tx.dispenseAudit.create({
      data: {
        org_id: req.orgId,
        task_id,
        result,
        reject_reason: reject_reason ?? null,
        reject_detail: mergeRejectDetail({
          rejectDetail: reject_detail,
          externalAudit: external_audit,
        }),
        audited_by: req.userId,
        audited_at: now,
      },
    });

    if (result === 'approved' || result === 'emergency_approved') {
      const nextStatus = task.cycle.set_plans.length > 0 ? 'setting' : 'visit_ready';
      await tx.medicationCycle.update({
        where: { id: task.cycle_id },
        data: { overall_status: nextStatus },
      });
      await tx.dispenseTask.update({
        where: { id: task_id },
        data: { status: 'completed' },
      });
    } else if (result === 'hold') {
      await tx.medicationCycle.update({
        where: { id: task.cycle_id },
        data: { overall_status: 'on_hold' },
      });
    } else if (result === 'rejected') {
      // Update MedicationCycle status back to dispensing for re-dispense
      await tx.medicationCycle.update({
        where: { id: task.cycle_id },
        data: { overall_status: 'dispensing' },
      });
      await tx.dispenseTask.update({
        where: { id: task_id },
        data: { status: 'in_progress' },
      });

      // Auto-create WorkflowException
      await tx.workflowException.create({
        data: {
          org_id: req.orgId,
          cycle_id: task.cycle_id,
          exception_type: 'dispense_audit_rejected',
          description: `調剤鑑査差戻し: ${reject_reason ?? '理由未記入'}${reject_detail ? ` — ${reject_detail}` : ''}`,
          severity: 'warning',
          status: 'open',
        },
      });

      const fallbackRecipients = await tx.membership.findMany({
        where: {
          org_id: req.orgId,
          is_active: true,
          role: { in: ['admin', 'pharmacist'] as never[] },
          user: {
            is_active: true,
          },
        },
        select: {
          user_id: true,
        },
      });

      const explicitUserIds = Array.from(
        new Set(
          [
            task.assigned_to ?? null,
            task.cycle.case_?.primary_pharmacist_id ?? null,
            ...fallbackRecipients.map((member) => member.user_id),
          ].filter((value): value is string => Boolean(value))
        )
      );

      await dispatchNotificationEvent(tx, {
        orgId: req.orgId,
        eventType: 'dispense_audit_rejected',
        type: 'urgent',
        title: '調剤鑑査で差戻しが発生しました',
        message: `${task.cycle.case_.patient.name} の調剤結果が差戻しになりました${task.due_date ? `（期限 ${task.due_date.toISOString().slice(0, 10)}）` : ''}`,
        link: `/dispensing/${task.id}`,
        metadata: {
          task_id,
          cycle_id: task.cycle_id,
          patient_id: task.cycle.patient_id,
          reject_reason: reject_reason ?? null,
          priority: task.priority,
        },
        explicitUserIds,
        dedupeKey: `dispense-audit-rejected:${task_id}:${audit.id}`,
      });
    }

    return audit;
  });

  if (!auditResult) return notFound('指定された調剤タスクが見つかりません');
  if ('error' in auditResult) return validationError(auditResult.error);

  return success(auditResult, 201);
}, {
  permission: 'canAuditDispense',
  message: '調剤鑑査の作成権限がありません',
});
