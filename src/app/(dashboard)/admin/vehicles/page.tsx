import { Metadata } from 'next';
import { MasterEditorView } from '../master-editor-view';

export const metadata: Metadata = {
  title: '車両マスター — PH-OS',
};

export default function VehiclesPage() {
  return (
    <MasterEditorView
      activeCategory="車両"
      listTitle="車両一覧"
      itemPrefix="車両"
      testId="vehicle-master-editor"
    />
  );
}
