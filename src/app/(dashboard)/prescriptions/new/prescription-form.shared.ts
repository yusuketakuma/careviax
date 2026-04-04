export const SOURCE_CONFIG = [
  { value: 'paper', label: '紙処方箋' },
  { value: 'fax', label: 'FAX' },
  { value: 'qr_scan', label: '電子お薬手帳QR' },
  { value: 'e_prescription', label: '電子処方箋' },
  { value: 'facility_batch', label: '施設一括' },
  { value: 'refill', label: 'リフィル' },
] as const;

export const SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  SOURCE_CONFIG.map(({ value, label }) => [value, label])
);

export const ROUTE_OPTIONS = [
  { value: 'internal', label: '内服' },
  { value: 'external', label: '外用' },
  { value: 'injection', label: '注射' },
  { value: 'other', label: 'その他' },
] as const;

export const METHOD_OPTIONS = [
  { value: 'standard', label: '通常' },
  { value: 'unit_dose', label: '一包化' },
  { value: 'crushed', label: '粉砕' },
  { value: 'other', label: 'その他' },
] as const;

export const INQUIRY_REASON_OPTIONS = [
  { value: '用量疑義', label: '用量疑義' },
  { value: '相互作用', label: '相互作用' },
  { value: '禁忌', label: '禁忌' },
  { value: '重複', label: '重複' },
  { value: 'その他', label: 'その他' },
] as const;

export function emptyLine() {
  return {
    line_number: 1,
    drug_name: '',
    dose: '',
    frequency: '',
    days: 1,
    is_generic: false,
  };
}

export async function fetchOrgJson<T>(args: {
  url: string;
  orgId: string;
  errorMessage: string;
}) {
  const response = await fetch(args.url, {
    headers: { 'x-org-id': args.orgId },
  });
  if (!response.ok) {
    throw new Error(args.errorMessage);
  }
  return response.json() as Promise<T>;
}
