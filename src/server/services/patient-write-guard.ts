import { conflict, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import type { AuthContext } from '@/lib/auth/context';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import type { NextResponse } from 'next/server';

type DbClient = Pick<typeof prisma, 'patient'>;
type WritablePatient = { id: string; archived_at: Date | null };
type RequireWritablePatientResult = { patient: WritablePatient } | { response: NextResponse };

export async function requireWritablePatient(
  db: DbClient,
  ctx: AuthContext,
  patientId: string,
): Promise<RequireWritablePatientResult> {
  const patient = await db.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id: patientId, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role },
    ),
    select: { id: true, archived_at: true },
  });

  if (!patient) {
    return { response: notFound('患者が見つかりません') };
  }

  if (patient.archived_at) {
    return {
      response: conflict('アーカイブ中の患者は復元するまで更新できません'),
    };
  }

  return { patient };
}
