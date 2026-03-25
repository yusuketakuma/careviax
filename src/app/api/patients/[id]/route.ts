import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth/config';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden } from '@/lib/api/response';
import { updatePatientSchema } from '@/lib/validations/patient';
import { prisma } from '@/lib/db/client';

async function getAuthContext(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return null;
  return { userId: session.user.id, orgId };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return forbidden('認証が必要です');

  const { id } = await params;

  const patient = await prisma.patient.findFirst({
    where: { id, org_id: ctx.orgId },
    include: {
      residences: true,
      cases: {
        orderBy: { created_at: 'desc' },
        include: {
          care_team_links: true,
        },
      },
      contacts: true,
      consents: true,
    },
  });

  if (!patient) return notFound('患者が見つかりません');

  return success(patient);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return forbidden('認証が必要です');

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updatePatientSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.patient.findFirst({
    where: { id, org_id: ctx.orgId },
  });
  if (!existing) return notFound('患者が見つかりません');

  const { address, birth_date, ...rest } = parsed.data;

  const patient = await withOrgContext(ctx.orgId, async (tx) => {
    const updated = await tx.patient.update({
      where: { id },
      data: {
        ...(birth_date ? { birth_date: new Date(birth_date) } : {}),
        ...rest,
      },
    });

    if (address !== undefined) {
      const primary = await tx.residence.findFirst({
        where: { patient_id: id, is_primary: true },
      });
      if (primary) {
        await tx.residence.update({
          where: { id: primary.id },
          data: { address },
        });
      } else {
        await tx.residence.create({
          data: {
            org_id: ctx.orgId,
            patient_id: id,
            address,
            is_primary: true,
          },
        });
      }
    }

    return updated;
  });

  return success(patient);
}
