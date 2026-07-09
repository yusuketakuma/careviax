import { Metadata } from 'next';
import { auth } from '@/lib/auth/config';
import { hasPermission } from '@/lib/auth/permissions';
import {
  buildVisitScheduleAssignmentWhere,
  canAccessVisitScheduleAssignment,
} from '@/lib/auth/visit-schedule-access';
import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import { prisma } from '@/lib/db/client';
import { resolveLocalUserByIdentity } from '@/lib/auth/user-resolution';
import { EvidenceCaptureContent } from './capture-content';
import { resolveCapturePatientContext, type CapturePatientContext } from './capture.shared';

export const metadata: Metadata = {
  title: '写真・証跡を撮る — PH-OS',
};

async function resolveInitialCapturePatientContext(
  visitId: string,
): Promise<CapturePatientContext | null> {
  const session = await auth();
  if (!session?.user?.email && !session?.user?.cognitoSub) return null;

  const localUser = await resolveLocalUserByIdentity({
    cognitoSub: session.user.cognitoSub,
    email: session.user.email,
  });
  const orgId = localUser?.org_id;
  if (!orgId) return null;

  const membership = await prisma.membership.findFirst({
    where: { user_id: localUser.id, org_id: orgId, is_active: true },
    select: { role: true },
  });
  if (!membership || !hasPermission(membership.role, 'canVisit')) return null;

  const accessContext = { userId: localUser.id, role: membership.role };
  const assignmentWhere = buildVisitScheduleAssignmentWhere(accessContext);

  const schedule = await prisma.visitSchedule.findFirst({
    where: {
      id: visitId,
      org_id: orgId,
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    },
    select: {
      pharmacist_id: true,
      scheduled_date: true,
      time_window_start: true,
      case_: {
        select: {
          primary_pharmacist_id: true,
          backup_pharmacist_id: true,
          patient: { select: { id: true, name: true } },
        },
      },
      visit_record: {
        select: {
          id: true,
          version: true,
          visit_started_at: true,
          visit_ended_at: true,
        },
      },
    },
  });
  if (!schedule) return null;
  if (!canAccessVisitScheduleAssignment(accessContext, schedule)) return null;

  const patientId = schedule.case_?.patient.id ?? null;
  if (patientId) {
    recordPhiReadAuditForRequest(
      {
        orgId,
        userId: localUser.id,
        role: membership.role,
        ...(localUser.default_site_id ? { actorSiteId: localUser.default_site_id } : {}),
      },
      { patientId, view: 'visit_evidence_capture' },
    );
  }

  return {
    patientId,
    patientName: schedule.case_?.patient.name ?? null,
    visitDateTimeLabel: resolveCapturePatientContext({
      scheduled_date: schedule.scheduled_date.toISOString(),
      time_window_start: schedule.time_window_start?.toISOString() ?? null,
      visit_record: schedule.visit_record,
    }).visitDateTimeLabel,
    visitRecordId: schedule.visit_record?.id ?? null,
    visitRecordVersion: schedule.visit_record?.version ?? null,
    visitStartedAt: schedule.visit_record?.visit_started_at?.toISOString() ?? null,
    visitEndedAt: schedule.visit_record?.visit_ended_at?.toISOString() ?? null,
  };
}

/**
 * p0_48「スマホで写真・証跡を撮る」: 訪問(予定)ID から患者を解決して表示する
 * モバイル没入型の証跡撮影画面(app-shell は最小シェルで描画される)。
 */
export default async function VisitEvidenceCapturePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const initialPatientContext = await resolveInitialCapturePatientContext(id);

  return <EvidenceCaptureContent visitId={id} initialPatientContext={initialPatientContext} />;
}
