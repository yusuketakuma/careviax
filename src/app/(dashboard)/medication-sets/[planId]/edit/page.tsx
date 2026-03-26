import { type Metadata } from 'next';
import { SetPlanEditContent } from './set-plan-edit-content';

export const metadata: Metadata = { title: 'セット計画編集 — CareViaX' };

export default function SetPlanEditPage() {
  return <SetPlanEditContent />;
}
