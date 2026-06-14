import { Metadata } from 'next';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { EmergencyRouteContent } from './emergency-route-content';

export const metadata: Metadata = {
  title: '緊急処方の割込・ルート再計算 — PH-OS',
};

type EmergencyRoutePageProps = {
  searchParams?: Promise<{ date?: string }>;
};

/**
 * /schedules/emergency-route(p0_20「緊急処方の割込・ルート再計算」)。
 * 本日の確定済み訪問を固定したまま緊急処方を割り込ませ、移動増を抑えた 2 案
 * (案1: 確定患者の移動なし / 案2: 1件だけ再確認を許可)を再計算して比較する。
 */
export default async function EmergencyRoutePage({ searchParams }: EmergencyRoutePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialDate =
    resolvedSearchParams?.date && /^\d{4}-\d{2}-\d{2}$/.test(resolvedSearchParams.date)
      ? resolvedSearchParams.date
      : undefined;

  return (
    <PageScaffold variant="bare">
      <EmergencyRouteContent initialDate={initialDate} />
    </PageScaffold>
  );
}
