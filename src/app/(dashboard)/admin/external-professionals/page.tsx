import { Metadata } from 'next';
import { MasterEditorView } from '../master-editor-view';

export const metadata: Metadata = {
  title: '他職種マスター — PH-OS',
};

export default function ExternalProfessionalsPage() {
  return (
    <MasterEditorView
      activeCategory="医療機関"
      listTitle="医療機関一覧"
      itemPrefix="医療機関"
      testId="external-professionals-master-editor"
    />
  );
}
