import { buildPatientHref } from '@/lib/patient/navigation';

export const QR_DRAFT_CONFIRM_SUCCESS_HREF = '/prescriptions';

export function buildQrDraftShortcutLinks(patientId: string | null) {
  return [
    { href: '/prescriptions', label: '処方受付一覧' },
    ...(patientId ? [{ href: buildPatientHref(patientId), label: '患者詳細' }] : []),
    { href: '/workflow', label: 'ワークフロー' },
  ];
}
