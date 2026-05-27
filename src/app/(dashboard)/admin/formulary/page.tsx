import { type Metadata } from 'next';
import { DrugMasterContent } from '../drug-masters/drug-master-content';

export const metadata: Metadata = {
  title: '採用薬マスター — PH-OS',
};

export default function FormularyPage() {
  return <DrugMasterContent variant="formulary" />;
}
