import { prisma } from '@/lib/db/client';
import { runJob } from '../runner';
import { trackPatientStatusChanges } from '@/server/services/patient-status-tracker';

export async function trackAllOrgPatientStatuses() {
  return runJob('patient_status_tracking', async () => {
    const orgs = await prisma.organization.findMany({
      select: { id: true },
    });

    let totalChanged = 0;
    for (const org of orgs) {
      const result = await trackPatientStatusChanges(prisma, {
        orgId: org.id,
        actorId: 'system',
      });
      totalChanged += result.changed.length;
    }

    return { processedCount: totalChanged };
  });
}
