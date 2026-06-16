import { PageScaffold } from '@/components/layout/page-scaffold';
import { PatientBoardLoadingShell } from './patient-board-loading';

export default function PatientsLoading() {
  return (
    <PageScaffold aria-label="患者一覧を読み込み中">
      <PatientBoardLoadingShell />
    </PageScaffold>
  );
}
