import { NextRequest, NextResponse } from 'next/server';
import { success, error } from '@/lib/api/response';
import { requireApiKeyOrAuthContext } from '@/lib/auth/context';
import {
  checkMedicationDeadlines,
  checkRefillPrescriptions,
  checkPrescriptionExpiry,
  checkUnrecordedVisits,
  generateVisitDemands,
  checkManagementPlanReviews,
  checkCallbackFollowups,
  checkResidenceGeocodeQuality,
  checkPreparationBacklog,
  generateBillingEvidenceDaily,
  runDailyOperations,
  runEveningOperations,
} from '@/server/jobs';

const JOB_HANDLERS: Record<string, () => Promise<{ processedCount: number; errors?: string[] }>> = {
  daily: runDailyOperations,
  evening: runEveningOperations,
  'daily-medication-check': checkMedicationDeadlines,
  'daily-refill-check': checkRefillPrescriptions,
  'daily-prescription-expiry': checkPrescriptionExpiry,
  'daily-visit-demand': generateVisitDemands,
  'daily-management-plan-review': checkManagementPlanReviews,
  'daily-callback-followups': checkCallbackFollowups,
  'daily-geocode-review': checkResidenceGeocodeQuality,
  'daily-preparation-check': checkPreparationBacklog,
  'daily-billing-evidence': generateBillingEvidenceDaily,
  'evening-unrecorded-visits': checkUnrecordedVisits,
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobType: string }> }
) {
  const { jobType } = await params;

  const authResult = await requireApiKeyOrAuthContext(req, {
    apiKey: process.env.JOB_API_KEY,
    permission: 'canAdmin',
    message: 'ジョブ実行には管理者権限またはAPIキーが必要です',
  });
  if ('response' in authResult) return authResult.response as NextResponse;

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
