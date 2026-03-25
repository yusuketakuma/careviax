import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);

  const billingMonth = searchParams.get('billing_month');
  const status = searchParams.get('status') ?? undefined;

  const where = {
    org_id: req.orgId,
    ...(billingMonth
      ? { billing_month: new Date(billingMonth) }
      : {}),
    ...(status ? { status } : {}),
  };

  const candidates = await withOrgContext(req.orgId, (tx) =>
    tx.billingCandidate.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ billing_month: 'desc' }, { created_at: 'desc' }],
    })
  );

  const hasMore = candidates.length > limit;
  const data = hasMore ? candidates.slice(0, limit) : candidates;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const { billing_month } = body as { billing_month?: string };
  if (!billing_month) return validationError('billing_month は必須です');

  const targetMonth = new Date(billing_month);
  if (isNaN(targetMonth.getTime())) {
    return validationError('billing_month の形式が不正です（YYYY-MM-DD）');
  }

  // Placeholder: In production, this would run the billing rule engine
  // to extract claimable billing codes for all active cases in the org.
  const created = await withOrgContext(req.orgId, async (tx) => {
    // Check for existing candidates for this month
    const existing = await tx.billingCandidate.count({
      where: { org_id: req.orgId, billing_month: targetMonth },
    });
    if (existing > 0) {
      return { already_exists: true, count: existing };
    }
    return { already_exists: false, count: 0 };
  });

  if (created.already_exists) {
    return success({
      message: `${billing_month} の請求候補は既に生成済みです（${created.count}件）`,
      generated: 0,
    });
  }

  return success({
    message: `${billing_month} の請求候補を生成しました`,
    generated: 0,
  });
});
