import type { Metadata } from 'next';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { SelectModeContent } from './select-mode-content';

// 全 route page は PageScaffold + metadata.title を必須とする(SSOT 4.4/7.9/2.2:
// 外枠・幅・余白の統一と route announcer 向けの一意 title)。
export const metadata: Metadata = {
  title: '業務モードの選択 — PH-OS',
};

export default function SelectModePage() {
  return (
    <PageScaffold variant="bare">
      <SelectModeContent />
    </PageScaffold>
  );
}
