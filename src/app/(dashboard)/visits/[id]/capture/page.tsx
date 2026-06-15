import { Metadata } from 'next';
import { auth } from '@/lib/auth/config';
import { prisma } from '@/lib/db/client';
import { resolveLocalUserByIdentity } from '@/lib/auth/user-resolution';
import { EvidenceCaptureContent } from './capture-content';
import type { CapturePatientContext } from './capture.shared';

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

  const schedule = await prisma.visitSchedule.findFirst({
    where: { id: visitId, org_id: orgId },
    select: {
      case_: { select: { patient: { select: { id: true, name: true } } } },
      visit_record: { select: { id: true } },
    },
  });
  if (!schedule) return null;

  return {
    patientId: schedule.case_?.patient.id ?? null,
    patientName: schedule.case_?.patient.name ?? null,
    visitRecordId: schedule.visit_record?.id ?? null,
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
