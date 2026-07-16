import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { internalError, registeredError, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';

const authenticatedPOST = withAuthContext<{ id: string }>(
  async (_req, _ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('薬局間連携IDが不正です');

    return registeredError(
      'BILLING_PARTNER_APPROVAL_NOT_IMPLEMENTED',
      '認証済みの両薬局による個別承認が実装されるまで薬局間連携を有効化できません',
    );
  },
  {
    permission: 'canManagePatientSharing',
    message: '薬局間連携の有効化権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
