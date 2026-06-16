import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withOrgContext } from '@/lib/db/rls';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import {
  getPatientPrivacyFlags,
  maskAddressDetail,
  maskContactValue,
  maskPhoneNumber,
} from '@/lib/patient/privacy';
import { updatePatientContactsSchema } from '@/lib/validations/patient';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import type { AuthContext } from '@/lib/auth/context';
import { requireWritablePatient } from '@/server/services/patient-write-guard';
import {
  buildPatientContactReadiness,
  normalizePatientPrimaryContacts,
} from '@/lib/patient/care-team-contact';
import { detectDuplicatePatientContacts } from '@/lib/patient/duplicate-detection';
import { isPrismaUniqueConstraintError } from '@/lib/db/prisma-errors';

async function assertPatient(ctx: AuthContext, id: string) {
  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role },
    ),
    select: { id: true },
  });
  if (!patient) throw new Error('PATIENT_NOT_FOUND');
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  try {
    await assertPatient(ctx, id);
  } catch {
    return notFound('患者が見つかりません');
  }

  const contacts = await prisma.contactParty.findMany({
    where: {
      org_id: ctx.orgId,
      patient_id: id,
    },
    orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
  });

  const privacy = getPatientPrivacyFlags(ctx.role);

  return success({
    data: contacts.map((contact) => ({
      ...contact,
      phone: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.phone) : contact.phone,
      fax: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.fax) : contact.fax,
      email: privacy.sensitiveFieldsMasked ? maskContactValue(contact.email) : contact.email,
      address: privacy.addressFieldsMasked ? maskAddressDetail(contact.address) : contact.address,
    })),
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updatePatientContactsSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }
  const normalizedContacts = normalizePatientPrimaryContacts(parsed.data.contacts);
  const duplicateContactWarnings = detectDuplicatePatientContacts(normalizedContacts);

  const writable = await requireWritablePatient(prisma, ctx, id);
  if ('response' in writable) return writable.response;
  const patientSettings = await prisma.patient.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      scheduling_preference: {
        select: {
          preferred_contact_name: true,
          preferred_contact_phone: true,
          visit_before_contact_required: true,
        },
      },
    },
  });

  let data;
  try {
    data = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        await tx.contactParty.deleteMany({
          where: { org_id: ctx.orgId, patient_id: id },
        });

        if (normalizedContacts.length > 0) {
          await tx.contactParty.createMany({
            data: normalizedContacts.map((contact) => ({
              org_id: ctx.orgId,
              patient_id: id,
              name: contact.name,
              relation: contact.relation,
              phone: contact.phone || null,
              email: contact.email || null,
              fax: contact.fax || null,
              organization_name: contact.organization_name || null,
              department: contact.department || null,
              address: contact.address || null,
              is_primary: contact.is_primary,
              is_emergency_contact: contact.is_emergency_contact,
              notes: contact.notes || null,
            })),
          });
        }

        await createAuditLogEntry(tx, ctx, {
          action: 'patient_contacts_updated',
          targetType: 'Patient',
          targetId: id,
          changes: {
            contact_count: normalizedContacts.length,
          },
        });

        return tx.contactParty.findMany({
          where: { org_id: ctx.orgId, patient_id: id },
          orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        });
      },
      { requestContext: ctx },
    );
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      return conflict('連絡先が同時に更新されました。再読み込みしてください');
    }
    throw error;
  }

  const privacy = getPatientPrivacyFlags(ctx.role);
  const contactReliability = buildPatientContactReadiness({
    contacts: data,
    preferredContactName: patientSettings?.scheduling_preference?.preferred_contact_name,
    preferredContactPhone: patientSettings?.scheduling_preference?.preferred_contact_phone,
    visitBeforeContactRequired:
      patientSettings?.scheduling_preference?.visit_before_contact_required,
  });

  return success({
    data: data.map((contact) => ({
      ...contact,
      phone: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.phone) : contact.phone,
      fax: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.fax) : contact.fax,
      email: privacy.sensitiveFieldsMasked ? maskContactValue(contact.email) : contact.email,
      address: privacy.addressFieldsMasked ? maskAddressDetail(contact.address) : contact.address,
    })),
    warnings: [
      ...(contactReliability.ready
        ? []
        : [
            {
              code: 'PATIENT_CONTACT_UNREADY',
              severity: 'warning',
              message: contactReliability.detail,
            },
          ]),
      ...duplicateContactWarnings,
    ],
    metadata: {
      contact_readiness: contactReliability,
      duplicate_contacts: duplicateContactWarnings,
    },
  });
}
