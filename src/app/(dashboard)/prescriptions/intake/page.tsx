import { type Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { IntakeTriageContent } from './intake-triage-content';

export const metadata: Metadata = {
  title: '処方取込 — PH-OS',
};

/**
 * /prescriptions/intake: 取込トリアージ(new_05_import)。
 * docs/design-gap-analysis-new.md 05_import の新規ルート案に従い、
 * 手入力フォーム(/prescriptions/new)とは別ルートで取込キューを扱う。
 */
export default function PrescriptionIntakeTriagePage() {
  return (
    <PageScaffold variant="bare">
      <Suspense fallback={<Loading />}>
        <IntakeTriageContent />
      </Suspense>
    </PageScaffold>
  );
}
