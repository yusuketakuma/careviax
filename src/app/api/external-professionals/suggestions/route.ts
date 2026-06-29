import { unstable_rethrow } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { findExternalProfessionalSuggestions } from '@/lib/contact-profiles';
import { canAccessCareCase, canAccessPatient } from '@/server/services/patient-access';

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const patientId = req.nextUrl.searchParams.get('patient_id')?.trim() || null;
    const caseId = req.nextUrl.searchParams.get('case_id')?.trim() || null;

    if (!patientId && !caseId) {
      return validationError('patient_id または case_id を指定してください');
    }

    const canAccessScope = caseId
      ? await canAccessCareCase({
          db: prisma,
          orgId: ctx.orgId,
          caseId,
          patientId: patientId ?? undefined,
          accessContext: ctx,
        })
      : await canAccessPatient({
          db: prisma,
          orgId: ctx.orgId,
          patientId: patientId as string,
          accessContext: ctx,
        });
    if (!canAccessScope) return success({ data: [] });

    const data = await findExternalProfessionalSuggestions(prisma, ctx.orgId, {
      patientId,
      caseId,
    });

    return success({
      data: data.map((item) => ({
        ...item,
        last_contacted_at: item.last_contacted_at?.toISOString() ?? null,
      })),
    });
  },
  {
    permission: 'canSendCareReport',
    message: '他職種候補の閲覧権限がありません',
  },
);

export async function GET(
  req: NextRequest,
  routeContext: { params: Promise<Record<string, string>> },
) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
