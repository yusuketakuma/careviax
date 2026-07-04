import { Loading } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';

export default function PcaPumpsLoading() {
  return (
    <PageScaffold aria-label="PCAポンプレンタルを読み込み中">
      <Loading label="PCAポンプレンタルを読み込み中..." />
    </PageScaffold>
  );
}
