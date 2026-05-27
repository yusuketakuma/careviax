import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { findExternalProfessionalSuggestions } from '@/lib/contact-profiles';
import { canAccessCareCase, canAccessPatient } from '@/server/services/patient-access';

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const patientId = req.nextUrl.searchParams.get('patient_id')?.trim() || null;
    const caseId = req.nextUrl.searchParams.get('case_id')?.trim() || null;

    if (!patientId && !caseId) {
      return validationError('patient_id または case_id を指定してください');
    }

    const canAccessScope = caseId
      ? await canAccessCareCase({
          db: prisma,
          orgId: req.orgId,
          caseId,
          patientId: patientId ?? undefined,
          accessContext: req,
        })
      : await canAccessPatient({
          db: prisma,
          orgId: req.orgId,
          patientId: patientId as string,
          accessContext: req,
        });
    if (!canAccessScope) return success({ data: [] });

    const data = await findExternalProfessionalSuggestions(prisma, req.orgId, {
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
    permission: 'canReport',
    message: '他職種候補の閲覧権限がありません',
  },
);
