import { TenantDetailContent } from './tenant-detail-content';

export default async function PlatformTenantDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return <TenantDetailContent orgId={orgId} />;
}
