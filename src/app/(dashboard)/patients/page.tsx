import { PatientsBoard } from './patients-board';
import { PageScaffold } from '@/components/layout/page-scaffold';

export default function PatientsPage() {
  return (
    <PageScaffold variant="bare">
      <PatientsBoard />
    </PageScaffold>
  );
}
