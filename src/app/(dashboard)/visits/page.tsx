import { Metadata } from 'next';
import { VisitsToday } from './visits-today';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '訪問 — PH-OS',
};

/**
 * /visits。ビューポート最上部は new_04_visit の「今日の訪問(出発前の準備チェック)」。
 */
export default function VisitsPage() {
  return (
    <PageScaffold variant="bare">
      <h1 className="sr-only">出発前チェック</h1>
      <VisitsToday />
    </PageScaffold>
  );
}
