import { encodePathSegment } from '@/lib/http/path-segment';

export const PHARMACY_DRUG_STOCKS_API_PATH = '/api/pharmacy-drug-stocks';
export const PHARMACY_DRUG_STOCK_REQUESTS_API_PATH = '/api/pharmacy-drug-stock-requests';
export const PHARMACY_DRUG_STOCK_TEMPLATES_API_PATH = '/api/pharmacy-drug-stock-templates';

function appendQuery(path: string, params?: URLSearchParams | string): string {
  if (params == null) return path;
  const query = typeof params === 'string' ? params : params.toString();
  return `${path}?${query}`;
}

export function buildPharmacyDrugStocksApiPath(params?: URLSearchParams | string): string {
  return appendQuery(PHARMACY_DRUG_STOCKS_API_PATH, params);
}

export function buildPharmacyDrugStockHistoryApiPath(params?: URLSearchParams | string): string {
  return appendQuery(`${PHARMACY_DRUG_STOCKS_API_PATH}/history`, params);
}

export function buildPharmacyDrugStockImpactApiPath(params?: URLSearchParams | string): string {
  return appendQuery(`${PHARMACY_DRUG_STOCKS_API_PATH}/impact`, params);
}

export function buildPharmacyDrugStockUsageMismatchApiPath(
  params?: URLSearchParams | string,
): string {
  return appendQuery(`${PHARMACY_DRUG_STOCKS_API_PATH}/usage-mismatch`, params);
}

export function buildPharmacyDrugStockBulkApiPath(): string {
  return `${PHARMACY_DRUG_STOCKS_API_PATH}/bulk`;
}

export function buildPharmacyDrugStockCopyApiPath(): string {
  return `${PHARMACY_DRUG_STOCKS_API_PATH}/copy`;
}

export function buildPharmacyDrugStockReviewApiPath(): string {
  return `${PHARMACY_DRUG_STOCKS_API_PATH}/review`;
}

export function buildPharmacyDrugStockSafetyFollowUpApiPath(): string {
  return `${PHARMACY_DRUG_STOCKS_API_PATH}/safety-follow-up`;
}

export function buildPharmacyDrugStockExportApiPath(params?: URLSearchParams | string): string {
  return appendQuery(`${PHARMACY_DRUG_STOCKS_API_PATH}/export`, params);
}

export function buildPharmacyDrugStockTemplateCsvApiPath(
  params?: URLSearchParams | string,
): string {
  return appendQuery(`${PHARMACY_DRUG_STOCKS_API_PATH}/template`, params);
}

export function buildPharmacyDrugStockRequestsApiPath(params?: URLSearchParams | string): string {
  return appendQuery(PHARMACY_DRUG_STOCK_REQUESTS_API_PATH, params);
}

export function buildPharmacyDrugStockRequestApiPath(requestId: string): string {
  return `${PHARMACY_DRUG_STOCK_REQUESTS_API_PATH}/${encodePathSegment(requestId)}`;
}

export function buildPharmacyDrugStockTemplatesApiPath(params?: URLSearchParams | string): string {
  return appendQuery(PHARMACY_DRUG_STOCK_TEMPLATES_API_PATH, params);
}

export function buildPharmacyDrugStockTemplateApiPath(templateId: string): string {
  return `${PHARMACY_DRUG_STOCK_TEMPLATES_API_PATH}/${encodePathSegment(templateId)}`;
}

export function buildPharmacyDrugStockTemplateApplyApiPath(templateId: string): string {
  return `${buildPharmacyDrugStockTemplateApiPath(templateId)}/apply`;
}
