import { type Metadata } from 'next';
import { DrugMasterContent } from '../drug-masters/drug-master-content';

export const metadata: Metadata = {
  title: '採用薬マスター — CareViaX',
};

export default function FormularyPage() {
  return <DrugMasterContent />;
}
