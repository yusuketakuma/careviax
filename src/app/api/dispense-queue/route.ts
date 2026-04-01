import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { annotateDispenseTask, sortDispenseTasks } from '@/server/services/dispense-task-list';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const now = new Date();
  const tasks = await prisma.dispenseTask.findMany({
    where: {
      org_id: req.orgId,
      status: { in: ['pending', 'in_progress'] },
    },
    orderBy: [
      {
        priority: 'asc', // emergency < urgent < normal sorts ascending with custom mapping below
      },
      { due_date: 'asc' },
      { created_at: 'asc' },
    ],
    include: {
      results: {
        select: {
          id: true,
          line_id: true,
          actual_drug_name: true,
          actual_drug_code: true,
          actual_quantity: true,
          actual_unit: true,
          discrepancy_reason: true,
          carry_type: true,
          special_notes: true,
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
          inquiries: {
            where: {
              OR: [{ result: null }, { result: 'pending' }],
            },
            orderBy: [{ inquired_at: 'desc' }, { created_at: 'desc' }],
            select: {
              id: true,
              line_id: true,
              reason: true,
              inquiry_to_physician: true,
              inquiry_content: true,
              result: true,
              change_detail: true,
              line: {
                select: {
                  id: true,
                  line_number: true,
                  drug_name: true,
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
              lines: {
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
        },
      },
    },
  });

  return success({
    data: sortDispenseTasks(tasks, 'created_at').map((task) => annotateDispenseTask(task, now)),
  });
}, {
  permission: 'canDispense',
  message: '調剤キューの閲覧権限がありません',
});
