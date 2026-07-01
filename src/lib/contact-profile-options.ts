import type { CommunicationChannel } from '@prisma/client';

export type ContactProfileKind =
  | 'facility_contact'
  | 'external_professional'
  | 'prescriber_institution';

/**
 * 送付方法（送付先・連絡先の編集 p0_26）で選択可能なチャネル一覧。
 * 既定は PH-OS 内共有。表示順は設計（PH-OS共有 / FAX / 電話 / メール / 郵送 / 対面）に合わせる。
 */
export const CONTACT_METHOD_OPTIONS = [
  'ph_os_share',
  'fax',
  'phone',
  'email',
  'postal',
  'in_person',
] as const satisfies readonly CommunicationChannel[];

export const CONTACT_METHOD_LABELS: Record<CommunicationChannel, string> = {
  ph_os_share: 'PH-OS共有',
  fax: 'FAX',
  phone: '電話',
  email: 'メール',
  postal: '郵送',
  in_person: '対面',
  ses: 'SESメール',
};

export function contactMethodLabel(value: CommunicationChannel | string | null | undefined) {
  if (!value) return '未設定';
  return CONTACT_METHOD_LABELS[value as CommunicationChannel] ?? value;
}
