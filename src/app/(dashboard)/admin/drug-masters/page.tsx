import { type Metadata } from 'next';
import { DrugMasterContent } from './drug-master-content';

export const metadata: Metadata = {
  title: '医薬品マスター管理 — CareViaX',
};

export default function DrugMastersPage() {
  return <DrugMasterContent />;
}
