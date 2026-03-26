import { NextResponse } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const billingMonth = searchParams.get('billing_month');

  const where = {
    org_id: req.orgId,
    ...(billingMonth ? { billing_month: new Date(billingMonth) } : {}),
    status: { in: ['confirmed', 'exported'] },
  };

  const candidates = await withOrgContext(req.orgId, (tx) =>
    tx.billingCandidate.findMany({
      where,
      orderBy: [{ billing_month: 'desc' }, { billing_code: 'asc' }],
    })
  );

  const header = [
    'id',
    'patient_id',
    'billing_month',
    'billing_code',
    'billing_name',
    'points',
    'status',
  ].join(',');

  const rows = candidates.map((c) => {
    const month = c.billing_month instanceof Date
      ? c.billing_month.toISOString().slice(0, 7)
      : String(c.billing_month);
    return [
      c.id,
      c.patient_id,
      month,
      c.billing_code,
      `"${c.billing_name.replace(/"/g, '""')}"`,
      c.points ?? '',
      c.status,
    ].join(',');
  });

  const csv = [header, ...rows].join('\n');
  const filename = billingMonth
    ? `billing_${billingMonth}.csv`
    : 'billing_candidates.csv';

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}, {
  permission: 'canReport',
  message: '請求候補のエクスポート権限がありません',
});
