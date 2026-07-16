import { prisma } from '@/lib/db/client';
import { runJob } from '../runner';
import { trackPatientStatusChanges } from '@/server/services/patient-status-tracker';
import { withOrgContext } from '@/lib/db/rls';
import { listOrganizationIds } from '../organization-iteration';

const PATIENT_STATUS_PAGE_SIZE = 100;

export async function trackAllOrgPatientStatuses() {
  return runJob('patient_status_tracking', async () => {
    const orgIds = await listOrganizationIds(prisma);
    const patientIdsByOrg = new Map<string, string[]>();

    for (const orgId of orgIds) {
      const patientIds: string[] = [];
      let cursor: string | undefined;
      for (;;) {
        const patients = await withOrgContext(orgId, (tx) =>
          tx.patient.findMany({
            where: {
              org_id: orgId,
              cases: {
                some: {
                  status: { in: ['assessment', 'active', 'on_hold'] },
                },
              },
            },
            orderBy: { id: 'asc' },
            take: PATIENT_STATUS_PAGE_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: { id: true },
          }),
        );
        if (patients.length === 0) break;
        patientIds.push(...patients.map(({ id }) => id));
        if (patients.length < PATIENT_STATUS_PAGE_SIZE) break;
        cursor = patients.at(-1)?.id;
      }
      patientIdsByOrg.set(orgId, patientIds);
    }

    let totalChanged = 0;
    for (const [orgId, patientIds] of patientIdsByOrg) {
      for (let index = 0; index < patientIds.length; index += PATIENT_STATUS_PAGE_SIZE) {
        const patientIdsPage = patientIds.slice(index, index + PATIENT_STATUS_PAGE_SIZE);
        const result = await withOrgContext(orgId, (tx) =>
          trackPatientStatusChanges(tx, {
            orgId,
            actorId: 'system',
            patientIds: patientIdsPage,
          }),
        );
        totalChanged += result.changed.length;
      }
    }

    return { processedCount: totalChanged };
  });
}
