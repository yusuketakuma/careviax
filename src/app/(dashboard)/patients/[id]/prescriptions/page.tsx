import { type Metadata } from 'next';
import { PrescriptionHistoryContent } from './prescription-history-content';

export const metadata: Metadata = {
  title: '処方内容一覧 — CareViaX',
};

export default function PatientPrescriptionsPage() {
  return <PrescriptionHistoryContent />;
}
