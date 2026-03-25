import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { success, forbidden, error } from '@/lib/api/response';
import {
  checkMedicationDeadlines,
  checkRefillPrescriptions,
  checkPrescriptionExpiry,
  checkUnrecordedVisits,
} from '@/server/jobs';

const JOB_HANDLERS: Record<string, () => Promise<{ processedCount: number; errors?: string[] }>> = {
  'daily-medication-check': checkMedicationDeadlines,
  'daily-refill-check': checkRefillPrescriptions,
  'daily-prescription-expiry': checkPrescriptionExpiry,
  'evening-unrecorded-visits': checkUnrecordedVisits,
};

/**
 * Validates the request using either admin role (via session) or API key header.
 * Called by EventBridge Scheduler with X-Api-Key header, or by admin users directly.
 */
async function isAuthorized(req: NextRequest): Promise<boolean> {
  // API key authentication (for EventBridge Scheduler)
  const apiKey = req.headers.get('x-api-key');
  if (apiKey && apiKey === process.env.JOB_API_KEY) {
    return true;
  }

  // Admin role authentication (for manual triggering by admin users)
  const orgId = req.headers.get('x-org-id');
  const userId = req.headers.get('x-user-id');
  if (orgId && userId) {
    const membership = await prisma.membership.findFirst({
      where: { user_id: userId, org_id: orgId, is_active: true },
      select: { role: true },
    });
    if (membership && ['owner', 'admin'].includes(membership.role)) {
      return true;
    }
  }

  return false;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobType: string }> }
) {
  const { jobType } = await params;

  const authorized = await isAuthorized(req);
  if (!authorized) {
    return forbidden('ジョブ実行には管理者権限またはAPIキーが必要です') as NextResponse;
  }

  const handler = JOB_HANDLERS[jobType];
  if (!handler) {
    return error('NOT_FOUND', `ジョブタイプ '${jobType}' は存在しません`, 404) as NextResponse;
  }

  try {
    const result = await handler();
    return success({ jobType, ...result }) as NextResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error('JOB_FAILED', `ジョブの実行に失敗しました: ${message}`, 500) as NextResponse;
  }
}
