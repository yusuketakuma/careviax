import { Prisma } from '@prisma/client';
import type { DateQuarantineSummary, DrugMasterImportLogDbClient, FetchLike } from './shared';

export const MHLW_MASTER_INDEX_PAGE_URL =
  'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000078916.html';

export type ParsedMhlwPriceRecord = {
  yj_code: string;
  drug_name: string;
  generic_name: string | null;
  manufacturer: string | null;
  unit: string | null;
  dosage_form: string | null;
  therapeutic_category: string | null;
  drug_price: Prisma.Decimal | null;
  is_generic: boolean;
  transitional_expiry_date: Date | null;
};

export type ParsedMhlwPriceWorkbook = {
  workbookUrl: string;
  sourceFileHash: string;
  records: ParsedMhlwPriceRecord[];
  skippedInvalidYjCount: number;
  candidateRecordCount: number;
  dateQuarantine: DateQuarantineSummary;
};

export type MhlwPriceWorkbookSources = {
  workbookUrls: string[];
  applicableDate: Date | null;
};

export type ParseMhlwPriceWorkbookOptions = {
  workbookUrl?: string;
  fetchImpl?: FetchLike;
};

export type ImportMhlwPriceListOptions = ParseMhlwPriceWorkbookOptions & {
  workbookUrls?: string[];
};
export type PreviewMhlwPriceListOptions = ImportMhlwPriceListOptions & {
  previewLimit?: number;
};
export type MhlwPriceImportDbClient = DrugMasterImportLogDbClient & {
  $queryRaw: Prisma.TransactionClient['$queryRaw'];
  $transaction?: <T>(fn: (tx: MhlwPriceVersionTransactionClient) => Promise<T>) => Promise<T>;
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany' | 'upsert'>;
  drugMasterChangeEvent: Pick<Prisma.TransactionClient['drugMasterChangeEvent'], 'create'>;
  drugPriceVersion: Pick<
    Prisma.TransactionClient['drugPriceVersion'],
    'findUnique' | 'create' | 'update' | 'updateMany'
  >;
};
export type MhlwPriceVersionTransactionClient = Pick<Prisma.TransactionClient, '$queryRaw'> & {
  drugPriceVersion: Pick<
    Prisma.TransactionClient['drugPriceVersion'],
    'findUnique' | 'create' | 'update' | 'updateMany'
  >;
};
export type MhlwPricePreviewDbClient = {
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany'>;
  drugPriceVersion?: Pick<Prisma.TransactionClient['drugPriceVersion'], 'findMany'>;
};
export type MhlwPriceDrugLookupDbClient = {
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany'>;
};
export type MhlwGenericMappingImportDbClient = DrugMasterImportLogDbClient & {
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany'>;
  genericDrugMapping: Pick<Prisma.TransactionClient['genericDrugMapping'], 'create' | 'deleteMany'>;
};
export type MhlwGenericFlagsPreviewDbClient = {
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany'>;
};
export type MhlwGenericMappingPreviewDbClient = {
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany'>;
};
export type PreviewMhlwGenericOptions = {
  workbookUrl?: string;
  fetchImpl?: FetchLike;
  previewLimit?: number;
};

export type ParsedGenericNameEntry = {
  generic_code: string;
  generic_name: string;
  standard_name: string;
  dosage_form: string | null;
  specification: string | null;
  lowest_price: Prisma.Decimal | null;
  add_on_scope: string | null;
  exception_codes: string[];
  brand_candidates: Array<{
    yj_code: string;
    drug_name: string;
    manufacturer: string | null;
  }>;
};
export type ParsedGenericNameWorkbook = {
  workbookUrl: string;
  sourceFileHash: string;
  entries: Array<Omit<ParsedGenericNameEntry, 'brand_candidates'>>;
  skippedInvalidYjCount: number;
};

export type ExistingMhlwPriceDrug = {
  id: string;
  yj_code: string;
  drug_price: { toString: () => string } | null;
  transitional_expiry_date: Date | null;
};
export type ExistingMhlwPriceVersion = {
  drug_master_id: string;
  effective_from: Date;
  drug_price: { toString: () => string } | null;
  transitional_expiry_date: Date | null;
};
export type ExistingMhlwOpenPriceVersion = {
  drug_master_id: string;
  effective_from: Date;
};
export type ExistingMhlwGenericFlagDrug = {
  yj_code: string;
  is_generic: boolean;
};
export type GenericNameMappingDrugMaster = {
  id: string;
  yj_code: string;
  drug_name: string;
  generic_name: string | null;
  manufacturer: string | null;
};

export type MhlwPricePreviewRow = {
  yj_code: string;
  drug_name: string;
  action: 'upsert';
  price_version_action: 'create' | 'update' | 'noop' | 'skipped_missing_effective_from';
  price_version_effective_from: string | null;
  price_version_close_count: number;
  price_version_close_effective_to: string | null;
  change_event_types: Array<'price_changed' | 'transitional_expiry_changed'>;
  previous_drug_price: string | null;
  next_drug_price: string | null;
  previous_transitional_expiry_date: string | null;
  next_transitional_expiry_date: string | null;
};

export type MhlwPriceImportPreview = {
  dryRun: true;
  workbookUrl: string | null;
  workbookUrls: string[];
  sourceFileHash: string | null;
  sourcePublishedAt: string | null;
  preview: {
    summary: {
      workbook_count: number;
      parsed_records: number;
      drug_master_upsert_count: number;
      skipped_invalid_yj: number;
      records_with_change_event: number;
      change_event_count: number;
      price_version_create_count: number;
      price_version_update_count: number;
      price_version_close_count: number;
      price_version_skipped_missing_effective_from: number;
      sampled_rows: number;
      quarantined_date_records?: number;
      quarantine_invalid_format_count?: number;
      quarantine_invalid_calendar_date_count?: number;
      quarantine_invalid_era_boundary_count?: number;
    };
    rows: MhlwPricePreviewRow[];
  };
};

export type MhlwGenericFlagPreviewRow = {
  yj_code: string;
  drug_name: string;
  action: 'upsert_generic_flag';
  previous_is_generic: boolean | null;
  next_is_generic: boolean;
};

export type MhlwGenericFlagImportPreview = {
  dryRun: true;
  operation: 'generic_flags';
  workbookUrl: string;
  sourceFileHash: string;
  sourcePublishedAt: string | null;
  preview: {
    summary: {
      parsed_records: number;
      drug_master_upsert_count: number;
      skipped_invalid_yj: number;
      changed_flag_count: number;
      sampled_rows: number;
      quarantined_date_records?: number;
      quarantine_invalid_format_count?: number;
      quarantine_invalid_calendar_date_count?: number;
      quarantine_invalid_era_boundary_count?: number;
    };
    rows: MhlwGenericFlagPreviewRow[];
  };
};

export type MhlwGenericMappingPreviewRow = {
  generic_name: string;
  standard_name: string;
  action: 'replace_mapping';
  brand_candidate_count: number;
  exception_code_count: number;
  lowest_price: string | null;
  add_on_scope: string | null;
  brand_candidates: Array<{
    yj_code: string;
    drug_name: string;
    manufacturer: string | null;
  }>;
};

export type MhlwGenericMappingImportPreview = {
  dryRun: true;
  operation: 'generic_mapping';
  workbookUrl: string;
  sourceFileHash: string;
  sourcePublishedAt: string | null;
  preview: {
    summary: {
      parsed_records: number;
      generic_mapping_replace_count: number;
      brand_candidate_count: number;
      skipped_invalid_yj: number;
      sampled_rows: number;
    };
    rows: MhlwGenericMappingPreviewRow[];
  };
};
