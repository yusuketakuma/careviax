import { type Metadata } from 'next';
import { DispenseConfirmContent } from './dispense-confirm-content';

export const metadata: Metadata = { title: '調剤確認 — CareViaX' };

export default function DispenseConfirmPage() {
  return <DispenseConfirmContent />;
}
