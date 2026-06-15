import { Metadata } from 'next';
import { MasterEditorView } from '../master-editor-view';

export const metadata: Metadata = {
  title: 'スタッフ運用管理 — PH-OS',
};

export default function StaffPage() {
  return (
    <MasterEditorView
      activeCategory="スタッフ"
      listTitle="スタッフ一覧"
      itemPrefix="スタッフ"
      testId="staff-master-editor"
    />
  );
}
