import type { Metadata } from 'next';
import { ResidualAdjustmentContent } from './residual-adjustment-content';

export const metadata: Metadata = {
  title: '残薬調整 — PH-OS',
};

export default async function ResidualAdjustmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ResidualAdjustmentContent patientId={id} />;
}
