import { conflict, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import type { AuthContext } from '@/lib/auth/context';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE } from '@/lib/patient/archive-summary';
import { acquireAdvisoryTxLock } from '@/lib/db/advisory-lock';
import type { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';

type DbClient = Pick<typeof prisma, 'patient'>;
type WritablePatient = { id: string; archived_at: Date | null };
type RequireWritablePatientResult = { patient: WritablePatient } | { response: NextResponse };
type PatientWriteTransaction = DbClient & Pick<Prisma.TransactionClient, '$executeRaw'>;

const PATIENT_WRITE_STATE_LOCK_NAMESPACE = 'patient_write_state';

/**
 * Serializes patient archive/restore transitions with patient-scoped mutations.
 * Callers must acquire this transaction-scoped lock before re-reading archive
 * state and keep the transaction open through every related write/audit.
 */
export async function acquirePatientWriteStateLock(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  orgId: string,
  patientId: string,
): Promise<void> {
  await acquireAdvisoryTxLock(
    tx as Prisma.TransactionClient,
    PATIENT_WRITE_STATE_LOCK_NAMESPACE,
    `${orgId}:${patientId}`,
  );
}

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
      response: conflict(PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE),
    };
  }

  return { patient };
}

export async function requireWritablePatientForUpdate(
  tx: PatientWriteTransaction,
  ctx: AuthContext,
  patientId: string,
): Promise<RequireWritablePatientResult> {
  await acquirePatientWriteStateLock(tx, ctx.orgId, patientId);
  return requireWritablePatient(tx, ctx, patientId);
}
