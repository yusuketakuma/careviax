import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { activePatientWorkspacePanelRegistry } from '@/server/patient-workspace/active-panel-registry';
import type { WorkspaceConditionInput } from '@/server/services/patient-detail-helpers';

type DbClient = typeof prisma | Prisma.TransactionClient;

type BuildPatientWorkspaceArgs = {
  orgId: string;
  patientId: string;
  caseIds: string[];
  allergyInfo: unknown;
  conditions: WorkspaceConditionInput[];
  swallowingRoute: string | null;
};

export async function buildPatientWorkspace(db: DbClient, args: BuildPatientWorkspaceArgs) {
  return activePatientWorkspacePanelRegistry.buildFirst({ db, args });
}
