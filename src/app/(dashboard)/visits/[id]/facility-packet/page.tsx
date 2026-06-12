import { FacilityPacketContent } from './facility-packet-content';

export const metadata = {
  title: '施設訪問パケット — PH-OS',
};

export default async function FacilityPacketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FacilityPacketContent scheduleId={id} />;
}
