import { PatientsBoard } from './patients-board';
import { PageScaffold } from '@/components/layout/page-scaffold';

export default function PatientsPage() {
  return (
    <PageScaffold variant="bare">
      <h1 className="sr-only">患者一覧</h1>
      <PatientsBoard />
    </PageScaffold>
  );
}
