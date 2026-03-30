import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { findLatestPrescriberInstitutionSuggestion } from '@/lib/prescriptions/prescriber-institutions';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const patientId = req.nextUrl.searchParams.get('patient_id')?.trim() || null;
  const caseId = req.nextUrl.searchParams.get('case_id')?.trim() || null;

  if (!patientId && !caseId) {
    return validationError('patient_id または case_id を指定してください');
  }

  const suggestion = await findLatestPrescriberInstitutionSuggestion(prisma, req.orgId, {
    patientId,
    caseId,
  });

  return success({
    data: suggestion
      ? {
          ...suggestion,
          prescribed_date: suggestion.prescribed_date.toISOString(),
        }
      : null,
  });
}, {
  permission: 'canReport',
  message: '処方元医療機関候補の閲覧権限がありません',
});
