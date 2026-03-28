import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

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

  // Sort by priority weight: emergency=0, urgent=1, normal=2
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
    return a.created_at.getTime() - b.created_at.getTime();
  });

  return success({
    data: sorted.map((task) => {
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
  permission: 'canDispense',
  message: '調剤キューの閲覧権限がありません',
});
