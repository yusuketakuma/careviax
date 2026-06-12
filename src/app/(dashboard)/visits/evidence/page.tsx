import { Metadata } from 'next';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { EvidenceGalleryContent } from './evidence-gallery-content';

export const metadata: Metadata = {
  title: '画像・証跡 — PH-OS',
};

/** p0_33「画像・証跡」: 訪問文脈の証跡ギャラリー(種類別フィルタ + 同期状態付き画像一覧)。 */
export default function VisitEvidencePage() {
  return (
    <PageScaffold variant="bare">
      <EvidenceGalleryContent />
    </PageScaffold>
  );
}
