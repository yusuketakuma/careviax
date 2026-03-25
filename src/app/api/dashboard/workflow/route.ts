import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const [cycleCounts, exceptionCount, pendingRequests, overdueRequests] =
    await Promise.all([
      // MedicationCycle status counts
      prisma.medicationCycle.groupBy({
        by: ['overall_status'],
        where: {
          org_id: req.orgId,
          overall_status: {
            notIn: ['cancelled', 'reported'],
          },
        },
        _count: { id: true },
      }),

      // WorkflowException open count
      prisma.workflowException.count({
        where: {
          org_id: req.orgId,
          status: 'open',
        },
      }),

      // CommunicationRequest pending (sent/received/in_progress)
      prisma.communicationRequest.count({
        where: {
          org_id: req.orgId,
          status: { in: ['sent', 'received', 'in_progress'] },
        },
      }),

      // CommunicationRequest overdue (past due_date, not closed/cancelled)
      prisma.communicationRequest.count({
        where: {
          org_id: req.orgId,
          status: { notIn: ['closed', 'cancelled', 'responded'] },
          due_date: { lt: new Date() },
        },
      }),
    ]);

  // Build cycle status map
  const cycleStatusMap: Record<string, number> = {};
  for (const row of cycleCounts) {
    cycleStatusMap[row.overall_status] = row._count.id;
  }

  // Refill prescriptions due in next 7 days
  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

  const upcomingRefills = await prisma.prescriptionIntake.findMany({
    where: {
      org_id: req.orgId,
      source_type: 'refill',
      refill_remaining_count: { gt: 0 },
    },
    orderBy: { created_at: 'asc' },
    take: 10,
    select: {
      id: true,
      cycle_id: true,
      refill_remaining_count: true,
      prescribed_date: true,
      created_at: true,
      cycle: {
        select: {
          patient_id: true,
          case_: {
            select: {
              patient: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  // Failed/pending delivery records
  const deliveryFailures = await prisma.deliveryRecord.count({
    where: {
      org_id: req.orgId,
      status: 'failed',
    },
  });

  return success({
    data: {
      cycle_status_counts: cycleStatusMap,
      workflow_exceptions: {
        open: exceptionCount,
      },
      communication_requests: {
        pending: pendingRequests,
        overdue: overdueRequests,
      },
      delivery: {
        failures: deliveryFailures,
      },
      refill_upcoming: upcomingRefills,
    },
  });
});
