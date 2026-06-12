import { Metadata } from 'next';
import { SavedViewsContent } from './saved-views-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: 'よく使う絞り込み — PH-OS',
};

/**
 * /views。p1_01「よく使う絞り込み」: 役割別プリセット 4 枚と
 * 「今の絞り込み条件」(me/preferences の saved_view)を表示する。
 * ナビには載せず、ダッシュボードのショートカットから開く。
 */
export default function SavedViewsPage() {
  return (
    <PageScaffold variant="bare">
      <SavedViewsContent />
    </PageScaffold>
  );
}
