import type { PrismaClient } from '@prisma/client';
import type { AuthContext } from '@/lib/auth/context';
import { requireWritablePatient } from '@/server/services/patient-write-guard';

type TaskWriteGuardDb = Pick<PrismaClient, 'careCase' | 'patient'>;

export async function requireWritableTaskPatient(
  db: TaskWriteGuardDb,
  ctx: AuthContext,
  task: { related_entity_type: string | null; related_entity_id: string | null },
) {
  if (task.related_entity_type === 'patient' && task.related_entity_id) {
    return requireWritablePatient(db, ctx, task.related_entity_id);
  }

  if (task.related_entity_type !== 'case' || !task.related_entity_id) return null;

  const careCase = await db.careCase.findFirst({
    where: {
      id: task.related_entity_id,
      org_id: ctx.orgId,
    },
    select: { patient_id: true },
  });
  if (!careCase) return null;

  return requireWritablePatient(db, ctx, careCase.patient_id);
}
