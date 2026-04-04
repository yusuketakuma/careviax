import { type Metadata } from 'next';
import { PrescriptionsWorkspace } from './prescriptions-workspace';

export const metadata: Metadata = {
  title: '処方箋受付 — CareViaX',
};

export default function PrescriptionsPage() {
  return <PrescriptionsWorkspace />;
}
