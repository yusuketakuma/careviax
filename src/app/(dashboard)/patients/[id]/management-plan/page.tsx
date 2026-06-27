import { redirect } from 'next/navigation';
import { buildPatientHref } from '@/lib/patient/navigation';

export default async function PatientManagementPlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(buildPatientHref(id));
}
