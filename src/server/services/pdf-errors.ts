export type PdfNotFoundResource =
  | 'careReport'
  | 'managementPlan'
  | 'visitRecord'
  | 'tracingReport'
  | 'conferenceNote'
  | 'billingCandidate'
  | 'patient';

const SAFE_MESSAGES: Record<PdfNotFoundResource, string> = {
  careReport: '報告書が見つかりません',
  managementPlan: '管理計画書が見つかりません',
  visitRecord: '訪問記録が見つかりません',
  tracingReport: 'トレーシングレポートが見つかりません',
  conferenceNote: 'カンファレンス記録が見つかりません',
  billingCandidate: '請求候補が見つかりません',
  patient: '患者が見つかりません',
};

export class PdfNotFoundError extends Error {
  readonly resource: PdfNotFoundResource;

  constructor(resource: PdfNotFoundResource) {
    super(SAFE_MESSAGES[resource]);
    this.name = 'PdfNotFoundError';
    this.resource = resource;
  }
}

export function pdfNotFoundMessage(resource: PdfNotFoundResource): string {
  return SAFE_MESSAGES[resource];
}
