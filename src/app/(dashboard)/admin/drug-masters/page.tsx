import { type Metadata } from 'next';
import { DrugMasterContent } from './drug-master-content';

export const metadata: Metadata = {
  title: '医薬品マスター管理 — PH-OS',
};

export default function DrugMastersPage() {
  // Was a fabricated MasterEditorView stub (fixed 薬剤マスター1〜8 / no-op save).
  return <DrugMasterContent variant="master" />;
}
