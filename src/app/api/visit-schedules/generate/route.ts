import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { error, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';

const VISIT_SCHEDULE_GENERATE_REMOVED_DETAILS = {
  replacement_endpoint: '/api/visit-schedule-proposals',
  reason_code: 'DIRECT_CONFIRMED_GENERATION_REMOVED',
  creates_confirmed_schedules: false,
} as const;

const authenticatedPOST = withAuthContext(
  async () =>
    error(
      'ENDPOINT_REMOVED',
      '訪問予定の直接一括生成は廃止されました。自動提案は /api/visit-schedule-proposals を使用してください。',
      410,
      VISIT_SCHEDULE_GENERATE_REMOVED_DETAILS,
    ),
  {
    permission: 'canVisit',
    message: '訪問予定の自動生成権限がありません',
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
