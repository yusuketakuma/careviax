import type { Metadata } from 'next';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { ClerkSupportContent } from './clerk-support-content';

// 全 route page は PageScaffold + metadata.title を必須とする(SSOT 4.4/7.9/2.2)。
export const metadata: Metadata = {
  title: '事務でできること — PH-OS',
};

export default function ClerkSupportPage() {
  return (
    <PageScaffold variant="bare">
      <ClerkSupportContent />
    </PageScaffold>
  );
}
