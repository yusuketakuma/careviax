import { Metadata } from 'next';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { VoiceMemoContent } from './voice-memo-content';

export const metadata: Metadata = {
  title: '音声メモ・文字起こし — PH-OS',
};

/** p1_11「音声メモ・文字起こし」: 訪問(予定/記録)ID の文脈で録音メモを扱う。 */
export default async function VoiceMemoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <PageScaffold variant="bare">
      <VoiceMemoContent visitId={id} />
    </PageScaffold>
  );
}
