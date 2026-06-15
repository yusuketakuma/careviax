import { type Metadata } from 'next';
import { MasterEditorView } from '../master-editor-view';

export const metadata: Metadata = {
  title: '医薬品マスター管理 — PH-OS',
};

export default function DrugMastersPage() {
  return (
    <MasterEditorView
      activeCategory="薬剤"
      listTitle="薬剤マスター一覧"
      itemPrefix="薬剤マスター"
      testId="drug-master-editor"
    />
  );
}
