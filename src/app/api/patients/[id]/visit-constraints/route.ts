import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withOrgContext } from '@/lib/db/rls';
import { internalError, success, validationError, notFound } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { upsertVisitConstraintsSchema } from '@/lib/validations/visit-constraints';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { hhmmToTimeDate } from '@/lib/datetime/time-of-day';
import { requireWritablePatient } from '@/server/services/patient-write-guard';

function toTimeValue(value?: string) {
  return value ? hhmmToTimeDate(value) : null;
}

async function authenticatedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問条件の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role },
    ),
    select: {
      id: true,
      scheduling_preference: true,
      residences: {
        where: { is_primary: true },
        take: 1,
      },
    },
  });
  if (!patient) return notFound('患者が見つかりません');

  return success({
    data: {
      scheduling_preference: patient.scheduling_preference,
      residence: patient.residences[0] ?? null,
    },
  });
}

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問条件の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = upsertVisitConstraintsSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const writable = await requireWritablePatient(prisma, ctx, id);
  if ('response' in writable) return writable.response;
  const patient = await prisma.patient.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      id: true,
      residences: {
        where: { is_primary: true },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!patient) return notFound('患者が見つかりません');

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    const preference = await tx.patientSchedulePreference.upsert({
      where: {
        patient_id: id,
      },
      create: {
        org_id: ctx.orgId,
        patient_id: id,
        preferred_weekdays: parsed.data.preferred_weekdays,
        preferred_time_from: toTimeValue(parsed.data.preferred_time_from),
        preferred_time_to: toTimeValue(parsed.data.preferred_time_to),
        phone_contact_from: toTimeValue(parsed.data.phone_contact_from),
        phone_contact_to: toTimeValue(parsed.data.phone_contact_to),
        facility_time_from: toTimeValue(parsed.data.facility_time_from),
        facility_time_to: toTimeValue(parsed.data.facility_time_to),
        family_presence_required: parsed.data.family_presence_required,
        visit_buffer_minutes: parsed.data.visit_buffer_minutes ?? null,
        preferred_contact_name: parsed.data.preferred_contact_name ?? null,
        preferred_contact_phone: parsed.data.preferred_contact_phone ?? null,
        notes: parsed.data.notes ?? null,
      },
      update: {
        preferred_weekdays: parsed.data.preferred_weekdays,
        preferred_time_from: toTimeValue(parsed.data.preferred_time_from),
        preferred_time_to: toTimeValue(parsed.data.preferred_time_to),
        phone_contact_from: toTimeValue(parsed.data.phone_contact_from),
        phone_contact_to: toTimeValue(parsed.data.phone_contact_to),
        facility_time_from: toTimeValue(parsed.data.facility_time_from),
        facility_time_to: toTimeValue(parsed.data.facility_time_to),
        family_presence_required: parsed.data.family_presence_required,
        visit_buffer_minutes: parsed.data.visit_buffer_minutes ?? null,
        preferred_contact_name: parsed.data.preferred_contact_name ?? null,
        preferred_contact_phone: parsed.data.preferred_contact_phone ?? null,
        notes: parsed.data.notes ?? null,
      },
    });

    if (patient.residences[0]) {
      await tx.residence.update({
        where: {
          id: patient.residences[0].id,
        },
        data: {
          ...(parsed.data.residence_lat !== undefined ? { lat: parsed.data.residence_lat } : {}),
          ...(parsed.data.residence_lng !== undefined ? { lng: parsed.data.residence_lng } : {}),
          ...(parsed.data.geocode_status !== undefined
            ? { geocode_status: parsed.data.geocode_status ?? null }
            : {}),
          ...(parsed.data.geocode_source !== undefined
            ? { geocode_source: parsed.data.geocode_source ?? null }
            : {}),
          ...(parsed.data.geocode_accuracy !== undefined
            ? { geocode_accuracy: parsed.data.geocode_accuracy ?? null }
            : {}),
          geocoded_at:
            parsed.data.residence_lat !== undefined || parsed.data.residence_lng !== undefined
              ? new Date()
              : undefined,
        },
      });
    }

    return preference;
  });

  return success({ data: updated });
}
