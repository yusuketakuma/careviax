import { Metadata } from 'next';
import { Suspense } from 'react';
import { CardWorkspace } from './card-workspace';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { Loading } from '@/components/ui/loading';
import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import { auth } from '@/lib/auth/config';
import { hasPermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { resolveLocalUserByIdentity } from '@/lib/auth/user-resolution';
import { getPatientOverview } from '@/server/services/patient-detail';
import type { PatientOverview } from './patient-detail.types';

export const metadata: Metadata = {
  title: 'カード — PH-OS',
};

async function resolveInitialPatientOverview(patientId: string) {
  const session = await auth();
  if (!session?.user?.email && !session?.user?.cognitoSub) return null;

  const localUser = await resolveLocalUserByIdentity({
    cognitoSub: session.user.cognitoSub,
    email: session.user.email,
  });
  if (!localUser?.org_id) return null;

  const membership = await prisma.membership.findFirst({
    where: { user_id: localUser.id, org_id: localUser.org_id, is_active: true },
    select: { role: true },
  });
  if (!membership || !hasPermission(membership.role, 'canViewDashboard')) return null;

  const requestContext = {
    orgId: localUser.org_id,
    userId: localUser.id,
    role: membership.role,
  };
  const overview = await withOrgContext(
    localUser.org_id,
    (tx) =>
      getPatientOverview(tx, {
        orgId: localUser.org_id,
        patientId,
        role: membership.role,
        userId: localUser.id,
      }),
    { requestContext },
  );
  if (!overview) return null;

  const serializedOverview = JSON.parse(JSON.stringify(overview)) as PatientOverview;
  recordPhiReadAuditForRequest(requestContext, {
    patientId,
    view: 'patient_overview_ssr',
  });

  return serializedOverview;
}

/**
 * /patients/[id] は現行カード作業台のみを表示する。
 * 患者プロフィール情報はカード内セクションへ統合し、route-gated の旧 profile UI は持たない。
 */
export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const initialPatient = await resolveInitialPatientOverview(id);

  return (
    <PageScaffold>
      <Suspense fallback={<Loading label="患者カードを読み込み中..." />}>
        <CardWorkspace patientId={id} initialPatient={initialPatient} />
      </Suspense>
    </PageScaffold>
  );
}
