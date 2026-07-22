import { format } from 'date-fns';
import { Prisma, type Gender } from '@prisma/client';
import type { AuthContext } from '@/lib/auth/context';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { conflict, notFound, validationError } from '@/lib/api/response';
import {
  findPatientDuplicateCandidates,
  parsePatientDuplicateBirthDate,
} from '@/lib/patient/duplicate-detection';
import { findCanonicalHomeVisitIntakeCase } from '@/lib/patient/home-visit-intake-target';
import {
  buildAssignedCareCaseWhere,
  buildPatientDetailWhere,
} from '@/server/services/patient-detail-scope';

export class PatientPatchConflictError extends Error {
  constructor(readonly conflictType: 'stale_patient' | 'stale_care_case') {
    super('patient patch optimistic concurrency conflict');
    this.name = 'PatientPatchConflictError';
  }
}

export class PatientPatchResponseError extends Error {
  constructor(readonly response: Response) {
    super('patient patch request rejected');
    this.name = 'PatientPatchResponseError';
  }
}

export function presentPatientPatch(patient: { id: string; updated_at: Date }) {
  return { id: patient.id, updated_at: patient.updated_at.toISOString() };
}

export function normalizeExpectedUpdatedAt(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function lockPatientPatchCareCaseAuthority(args: {
  tx: Prisma.TransactionClient;
  ctx: AuthContext;
  patientId: string;
  assignedCareCaseWhere?: Prisma.CareCaseWhereInput | null;
  careCaseId: string | null | undefined;
  expectedCareCaseVersion: number | null | undefined;
}) {
  await args.tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "Patient" WHERE "id" = ${args.patientId} AND "org_id" = ${args.ctx.orgId} FOR UPDATE`,
  );
  await args.tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "CareCase" WHERE "patient_id" = ${args.patientId} AND "org_id" = ${args.ctx.orgId} FOR UPDATE`,
  );
  const canonicalCase = await findCanonicalHomeVisitIntakeCase(args.tx, {
    orgId: args.ctx.orgId,
    patientId: args.patientId,
    assignedCareCaseWhere: args.assignedCareCaseWhere,
  });
  if (
    canonicalCase
      ? args.careCaseId !== canonicalCase.id ||
        args.expectedCareCaseVersion !== canonicalCase.version
      : args.careCaseId !== null || args.expectedCareCaseVersion !== null
  ) {
    throw new PatientPatchConflictError('stale_care_case');
  }
  return canonicalCase;
}

type PreflightArgs = {
  tx: Prisma.TransactionClient;
  ctx: AuthContext;
  patientId: string;
  nextIdentity: { name?: string; gender?: Gender; birthDate?: string };
  pharmacistIds: string[];
  staffIds: string[];
  duplicateAcknowledged: boolean;
  hasIntakeWrites: boolean;
  hasCareCasePair: boolean;
};

export async function preparePatientPatchTransaction(args: PreflightArgs) {
  const { tx, ctx, patientId } = args;
  const existing = await tx.patient.findFirst({
    where: buildPatientDetailWhere({
      orgId: ctx.orgId,
      patientId,
      role: ctx.role,
      userId: ctx.userId,
    }),
  });
  if (!existing) throw new PatientPatchResponseError(notFound('患者が見つかりません'));
  if (existing.archived_at) {
    throw new PatientPatchResponseError(conflict('アーカイブ中の患者は復元するまで更新できません'));
  }

  if (args.pharmacistIds.length > 0 || args.staffIds.length > 0) {
    const references = await validateOrgReferences(
      ctx.orgId,
      {
        ...(args.pharmacistIds.length > 0 ? { pharmacist_ids: args.pharmacistIds } : {}),
        ...(args.staffIds.length > 0 ? { staff_ids: args.staffIds } : {}),
      },
      tx,
    );
    if (!references.ok) throw new PatientPatchResponseError(references.response);
  }

  const identityChanged =
    args.nextIdentity.name !== undefined ||
    args.nextIdentity.gender !== undefined ||
    args.nextIdentity.birthDate !== undefined;
  const nextBirthDateKey =
    args.nextIdentity.birthDate ??
    (existing.birth_date instanceof Date
      ? format(existing.birth_date, 'yyyy-MM-dd')
      : String(existing.birth_date).slice(0, 10));
  const duplicateBirthDate = identityChanged
    ? parsePatientDuplicateBirthDate(nextBirthDateKey)
    : null;
  if (identityChanged && !duplicateBirthDate) {
    throw new PatientPatchResponseError(validationError('生年月日の形式が不正です'));
  }
  const duplicateCandidates =
    identityChanged && duplicateBirthDate
      ? await findPatientDuplicateCandidates(tx, {
          orgId: ctx.orgId,
          name: args.nextIdentity.name ?? existing.name,
          birthDate: duplicateBirthDate,
          gender: args.nextIdentity.gender ?? existing.gender,
          excludePatientId: patientId,
          access: { userId: ctx.userId, role: ctx.role },
        })
      : [];
  if (duplicateCandidates.length > 0 && !args.duplicateAcknowledged) {
    throw new PatientPatchResponseError(
      conflict('重複している可能性がある患者が存在します', {
        duplicate_type: 'patient_identity',
        duplicates: duplicateCandidates,
      }),
    );
  }

  const assignedCareCaseWhere = buildAssignedCareCaseWhere(ctx);
  if (args.hasIntakeWrites) {
    if (!args.hasCareCasePair) {
      throw new PatientPatchResponseError(
        validationError('受付情報を更新するにはケースIDと版情報の組が必要です'),
      );
    }
  }

  return { existing, duplicateCandidates, assignedCareCaseWhere };
}
