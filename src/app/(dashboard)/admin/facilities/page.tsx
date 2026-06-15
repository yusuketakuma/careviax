import { Metadata } from 'next';
import { MasterEditorView } from '../master-editor-view';

export const metadata: Metadata = {
  title: '施設マスター — PH-OS',
};

export default function FacilitiesPage() {
  return (
    <MasterEditorView
      activeCategory="施設"
      listTitle="施設一覧"
      itemPrefix="施設"
      testId="facility-master-editor"
    />
  );
}
