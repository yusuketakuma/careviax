import { Metadata } from 'next';
import { EvidenceCaptureContent } from './capture-content';

export const metadata: Metadata = {
  title: '写真・証跡を撮る — PH-OS',
};

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

  return <EvidenceCaptureContent visitId={id} />;
}
