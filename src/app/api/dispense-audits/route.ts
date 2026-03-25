import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  // Return dispense tasks that have been completed (dispensed) but not yet audited
  const tasks = await prisma.dispenseTask.findMany({
    where: {
      org_id: req.orgId,
      status: 'completed',
      audits: { none: {} },
    },
    orderBy: [{ priority: 'asc' }, { updated_at: 'asc' }],
    include: {
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
              drug_name: true,
              drug_code: true,
              dose: true,
              frequency: true,
              days: true,
              quantity: true,
              unit: true,
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
    return wa !== wb ? wa - wb : a.updated_at.getTime() - b.updated_at.getTime();
  });

  return success({ data: sorted });
});

const createDispenseAuditSchema = z.object({
  task_id: z.string().min(1),
  result: z.enum(['approved', 'rejected', 'hold', 'emergency_approved']),
  reject_reason: z.string().optional(),
  reject_detail: z.string().optional(),
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createDispenseAuditSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { task_id, result, reject_reason, reject_detail } = parsed.data;

  if (result === 'rejected' && !reject_reason) {
    return validationError('差戻し時は理由コードが必須です');
  }

  const auditResult = await withOrgContext(req.orgId, async (tx) => {
    // Verify task belongs to this org
    const task = await tx.dispenseTask.findFirst({
      where: { id: task_id, org_id: req.orgId },
      select: { id: true, cycle_id: true },
    });
    if (!task) return null;

    const now = new Date();

    // Create DispenseAudit
    const audit = await tx.dispenseAudit.create({
      data: {
        org_id: req.orgId,
        task_id,
        result,
        reject_reason: reject_reason ?? null,
        reject_detail: reject_detail ?? null,
        audited_by: req.userId,
        audited_at: now,
      },
    });

    if (result === 'approved' || result === 'emergency_approved') {
      // Update MedicationCycle status to audited
      await tx.medicationCycle.update({
        where: { id: task.cycle_id },
        data: { overall_status: 'audited' },
      });
    } else if (result === 'rejected') {
      // Update MedicationCycle status back to dispensing for re-dispense
      await tx.medicationCycle.update({
        where: { id: task.cycle_id },
        data: { overall_status: 'dispensing' },
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
    }

    return audit;
  });

  if (!auditResult) return notFound('指定された調剤タスクが見つかりません');

  return success(auditResult, 201);
});
