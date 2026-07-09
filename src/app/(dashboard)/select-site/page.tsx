import type { Metadata } from 'next';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { SelectSiteContent } from './select-site-content';

// 全 route page は PageScaffold + metadata.title を必須とする(SSOT 4.4/7.9/2.2)。
export const metadata: Metadata = {
  title: '使う薬局の選択 — PH-OS',
};

export default function SelectSitePage() {
  return (
    <PageScaffold variant="bare">
      <SelectSiteContent />
    </PageScaffold>
  );
}
