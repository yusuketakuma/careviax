import { Metadata } from 'next';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { HandoffWorkspace } from './handoff-workspace';

export const metadata: Metadata = {
  title: 'ハンドオフ — PH-OS',
};

/**
 * /handoff。ビューポート最上部は new_12_handoff のハンドオフ(責任の移動)ボード
 * (私が渡した / 私に来た + 3点セットのルール帯 + 右レール)。
 */
export default function HandoffPage() {
  return (
    <PageScaffold variant="bare">
      <div className="xl:min-h-[calc(100vh-4rem)]">
        <HandoffWorkspace />
      </div>
    </PageScaffold>
  );
}
