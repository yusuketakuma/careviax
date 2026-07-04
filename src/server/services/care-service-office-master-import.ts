import type { PrismaClient, ProfessionTypeEnum } from '@prisma/client';
import {
  decodeTextBuffer,
  fetchBytes,
  fetchText,
  normalizeCell,
  parseDelimitedRows,
  readDelimitedCell,
  resolveImportSourceUrl,
  stripBom,
  type DrugMasterImportUrlPolicy,
  type FetchLike,
} from '@/server/services/drug-master-import/shared';

const BYTES_PER_MIB = 1024 * 1024;
const CARE_SERVICE_SOURCE = 'mhlw_price';

export const MHLW_CARE_SERVICE_OPEN_DATA_PAGE_URL =
  'https://www.mhlw.go.jp/stf/kaigo-kouhyou_opendata.html';

export const MHLW_CARE_SERVICE_IMPORT_URL_POLICY: DrugMasterImportUrlPolicy = {
  source: CARE_SERVICE_SOURCE,
  allowedHosts: ['www.mhlw.go.jp'],
  maxBytes: 32 * BYTES_PER_MIB,
};

type CareServiceProfessionType =
  | 'nurse'
  | 'care_manager'
  | 'home_helper'
  | 'care_staff'
  | 'physical_therapist'
  | 'occupational_therapist'
  | 'speech_therapist'
  | 'other';

type CareServiceDefinition = {
  code: string;
  label: string;
  professionType: CareServiceProfessionType;
};

export const CARE_SERVICE_DEFINITIONS: CareServiceDefinition[] = [
  { code: '110', label: '訪問介護', professionType: 'home_helper' },
  { code: '130', label: '訪問看護', professionType: 'nurse' },
  { code: '150', label: '通所介護', professionType: 'care_staff' },
  { code: '155', label: '通所介護（療養通所介護）', professionType: 'care_staff' },
  { code: '170', label: '福祉用具貸与', professionType: 'other' },
  { code: '210', label: '短期入所生活介護', professionType: 'care_staff' },
  { code: '220', label: '短期入所療養介護（介護老人保健施設）', professionType: 'nurse' },
  { code: '230', label: '短期入所療養介護（療養病床を有する病院等）', professionType: 'nurse' },
  { code: '430', label: '居宅介護支援', professionType: 'care_manager' },
  { code: '551', label: '短期入所療養介護（介護医療院）', professionType: 'nurse' },
  { code: '710', label: '夜間対応型訪問介護', professionType: 'home_helper' },
  { code: '720', label: '認知症対応型通所介護', professionType: 'care_staff' },
  { code: '760', label: '定期巡回・随時対応型訪問介護看護', professionType: 'nurse' },
  { code: '770', label: '看護小規模多機能型居宅介護', professionType: 'nurse' },
  { code: '780', label: '地域密着型通所介護', professionType: 'care_staff' },
];

type CareServiceOfficeImportDbClient = {
  organization: Pick<PrismaClient['organization'], 'findMany'>;
  externalProfessional: Pick<
    PrismaClient['externalProfessional'],
    'findMany' | 'update' | 'create'
  >;
};

type ExistingExternalProfessional = {
  id: string;
  profession_type: ProfessionTypeEnum;
  name: string;
  organization_name: string | null;
  phone: string | null;
  fax: string | null;
  address: string | null;
  notes: string | null;
};

type CareServiceOfficeRecord = {
  serviceCode: string;
  serviceLabel: string;
  officeCode: string;
  prefectureCode: string | null;
  officeName: string;
  corporationName: string | null;
  address: string | null;
  phone: string | null;
  fax: string | null;
  professionType: CareServiceProfessionType;
};

type ImportOptions = {
  sourceUrls?: string[];
  serviceCodes?: string[];
  targetOrgIds?: string[];
  autoCreatePrefectureCodes?: string[];
  fetchImpl?: FetchLike;
};

function normalizePhoneLike(value: string | null) {
  const normalized = normalizeCell(value);
  if (!normalized) return null;
  return normalized.replace(/[^\d+()-]/g, '') || normalized;
}

function headerIndex(headers: string[], ...aliases: string[]) {
  return headers.findIndex((header) => aliases.some((alias) => header === alias));
}

function normalizeOfficeCode(value: string | null) {
  return normalizeCell(value)?.replace(/[^\dA-Za-z_-]/g, '') ?? null;
}

function definitionByCode(code: string) {
  const definition = CARE_SERVICE_DEFINITIONS.find((item) => item.code === code);
  if (!definition) {
    throw new Error(`未対応の介護サービスコードです: ${code}`);
  }
  return definition;
}

export function parseCareServiceOfficeCsv(text: string, definition: CareServiceDefinition) {
  const rows = parseDelimitedRows(text);
  const headers = rows[0]?.map((header) => stripBom(header).trim()) ?? [];
  const prefectureIndex = headerIndex(headers, '都道府県コード又は市町村コード');
  const officeNameIndex = headerIndex(headers, '事業所名');
  const serviceLabelIndex = headerIndex(headers, 'サービスの種類');
  const addressIndex = headerIndex(headers, '住所');
  const phoneIndex = headerIndex(headers, '電話番号');
  const faxIndex = headerIndex(headers, 'FAX番号');
  const corporationIndex = headerIndex(headers, '法人の名称');
  const officeCodeIndex = headerIndex(headers, '事業所番号');

  if (officeNameIndex < 0 || officeCodeIndex < 0) {
    throw new Error('介護サービス事業所CSVに必要な 事業所名 / 事業所番号 ヘッダーがありません');
  }

  return rows.slice(1).flatMap((row): CareServiceOfficeRecord[] => {
    const officeCode = normalizeOfficeCode(readDelimitedCell(row, officeCodeIndex));
    const officeName = normalizeCell(readDelimitedCell(row, officeNameIndex));
    if (!officeCode || !officeName) return [];

    const rawPrefecture = normalizeCell(readDelimitedCell(row, prefectureIndex));
    const prefectureCode = rawPrefecture?.slice(0, 2) ?? null;

    return [
      {
        serviceCode: definition.code,
        serviceLabel: normalizeCell(readDelimitedCell(row, serviceLabelIndex)) ?? definition.label,
        officeCode,
        prefectureCode,
        officeName,
        corporationName: normalizeCell(readDelimitedCell(row, corporationIndex)),
        address: normalizeCell(readDelimitedCell(row, addressIndex)),
        phone: normalizePhoneLike(readDelimitedCell(row, phoneIndex)),
        fax: normalizePhoneLike(readDelimitedCell(row, faxIndex)),
        professionType: definition.professionType,
      },
    ];
  });
}

export function resolveLatestCareServiceOfficeCsvUrls(
  html: string,
  serviceCodes = CARE_SERVICE_DEFINITIONS.map((definition) => definition.code),
  pageUrl = MHLW_CARE_SERVICE_OPEN_DATA_PAGE_URL,
) {
  const requestedCodes = new Set(serviceCodes);
  const urls = new Map<string, string>();
  const matches = html.matchAll(/href="([^"]*jigyosho_(\d{3})\.csv)"/gi);

  for (const match of matches) {
    const code = match[2];
    if (!requestedCodes.has(code) || urls.has(code)) continue;
    urls.set(code, resolveImportSourceUrl(match[1], pageUrl, MHLW_CARE_SERVICE_IMPORT_URL_POLICY));
  }

  const missing = [...requestedCodes].filter((code) => !urls.has(code));
  if (missing.length > 0) {
    throw new Error(`介護サービス事業所CSVを解決できませんでした: ${missing.join(', ')}`);
  }

  return [...urls.entries()].map(([code, url]) => ({ code, url }));
}

async function resolveSourceUrls(options: ImportOptions) {
  if (options.sourceUrls && options.sourceUrls.length > 0) {
    return options.sourceUrls.map((url) => {
      const match = url.match(/jigyosho_(\d{3})/);
      if (!match) throw new Error(`介護サービスコードをURLから解決できませんでした: ${url}`);
      return {
        code: match[1],
        url: resolveImportSourceUrl(
          url,
          MHLW_CARE_SERVICE_OPEN_DATA_PAGE_URL,
          MHLW_CARE_SERVICE_IMPORT_URL_POLICY,
        ),
      };
    });
  }

  const html = await fetchText(MHLW_CARE_SERVICE_OPEN_DATA_PAGE_URL, {
    fetchImpl: options.fetchImpl,
    policy: MHLW_CARE_SERVICE_IMPORT_URL_POLICY,
  });
  return resolveLatestCareServiceOfficeCsvUrls(html, options.serviceCodes);
}

function normalizePrefectureCodes(codes: string[] | undefined) {
  const source =
    codes ?? process.env.CARE_SERVICE_MASTER_AUTO_CREATE_PREFECTURE_CODES?.split(',') ?? [];
  return new Set(
    source
      .map((code) => code.trim())
      .filter(Boolean)
      .map((code) => code.padStart(2, '0')),
  );
}

async function fetchRecords(options: ImportOptions) {
  const urls = await resolveSourceUrls(options);
  const records = (
    await Promise.all(
      urls.map(async ({ code, url }) => {
        const definition = definitionByCode(code);
        const buffer = await fetchBytes(url, {
          fetchImpl: options.fetchImpl,
          policy: MHLW_CARE_SERVICE_IMPORT_URL_POLICY,
        });
        return parseCareServiceOfficeCsv(decodeTextBuffer(buffer), definition);
      }),
    )
  ).flat();
  return { records: uniqueByOfficeCode(records), sourceUrls: urls.map((item) => item.url) };
}

function uniqueByOfficeCode(records: CareServiceOfficeRecord[]) {
  const map = new Map<string, CareServiceOfficeRecord>();
  for (const record of records) {
    const key = `${record.serviceCode}:${record.officeCode}`;
    const existing = map.get(key);
    if (!existing || (!existing.address && record.address)) {
      map.set(key, record);
    }
  }
  return [...map.values()];
}

function sourceMarker(record: Pick<CareServiceOfficeRecord, 'serviceCode' | 'officeCode'>) {
  return `mhlw-care-service:${record.serviceCode}:${record.officeCode}`;
}

function singleValueMap<T>(items: T[], keyOf: (item: T) => string | null | undefined) {
  const values = new Map<string, T | null>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    values.set(key, values.has(key) ? null : item);
  }
  return values;
}

function buildOfficeIdentity(record: Pick<CareServiceOfficeRecord, 'officeName' | 'serviceLabel'>) {
  return `${record.officeName}（${record.serviceLabel}）`;
}

function buildUpdateData(existing: ExistingExternalProfessional, record: CareServiceOfficeRecord) {
  const data: Partial<
    Pick<
      ExistingExternalProfessional,
      'profession_type' | 'name' | 'organization_name' | 'address' | 'phone' | 'fax'
    >
  > = {};
  const name = buildOfficeIdentity(record);

  if (existing.profession_type !== record.professionType)
    data.profession_type = record.professionType;
  if (existing.name !== name) data.name = name;
  if (existing.organization_name !== record.officeName) data.organization_name = record.officeName;
  if (record.address && existing.address !== record.address) data.address = record.address;
  if (record.phone && existing.phone !== record.phone) data.phone = record.phone;
  if (record.fax && existing.fax !== record.fax) data.fax = record.fax;

  return data;
}

export async function importCareServiceOfficeOpenData(
  db: CareServiceOfficeImportDbClient,
  options: ImportOptions = {},
) {
  const { records, sourceUrls } = await fetchRecords(options);
  const autoCreatePrefectureCodes = normalizePrefectureCodes(options.autoCreatePrefectureCodes);
  const organizations = await db.organization.findMany({
    where: options.targetOrgIds ? { id: { in: options.targetOrgIds } } : undefined,
    select: { id: true },
  });

  let createdCount = 0;
  let updatedCount = 0;
  let matchedCount = 0;

  for (const organization of organizations) {
    const existing = await db.externalProfessional.findMany({
      where: { org_id: organization.id },
      select: {
        id: true,
        profession_type: true,
        name: true,
        organization_name: true,
        phone: true,
        fax: true,
        address: true,
        notes: true,
      },
    });
    const existingByMarker = new Map(
      existing.flatMap((item) => {
        const match = item.notes?.match(/mhlw-care-service:(\d{3}):([A-Za-z0-9_-]+)/);
        return match ? [[`${match[1]}:${match[2]}`, item]] : [];
      }),
    );
    const existingByUniqueName = singleValueMap(existing, (item) => item.name);
    const knownMarkers = new Set(existingByMarker.keys());
    const knownNames = new Set(existing.map((item) => item.name));

    for (const record of records) {
      const markerKey = `${record.serviceCode}:${record.officeCode}`;
      const name = buildOfficeIdentity(record);
      const item = existingByMarker.get(markerKey) ?? existingByUniqueName.get(name);
      if (!item) continue;
      matchedCount++;
      knownMarkers.add(markerKey);
      knownNames.add(name);

      const data = buildUpdateData(item, record);
      if (Object.keys(data).length === 0) continue;
      await db.externalProfessional.update({
        where: { id: item.id },
        data,
      });
      updatedCount++;
    }

    if (autoCreatePrefectureCodes.size === 0) continue;

    for (const record of records) {
      const markerKey = `${record.serviceCode}:${record.officeCode}`;
      const name = buildOfficeIdentity(record);
      if (!record.prefectureCode || !autoCreatePrefectureCodes.has(record.prefectureCode)) continue;
      if (knownMarkers.has(markerKey) || knownNames.has(name)) continue;

      await db.externalProfessional.create({
        data: {
          org_id: organization.id,
          profession_type: record.professionType,
          name,
          organization_name: record.officeName,
          phone: record.phone,
          fax: record.fax,
          address: record.address,
          notes: `MHLW care service open data auto-created (${sourceMarker(record)})`,
        },
      });
      knownMarkers.add(markerKey);
      knownNames.add(name);
      createdCount++;
    }
  }

  return {
    processedCount: createdCount + updatedCount,
    scannedCount: records.length,
    matchedCount,
    createdCount,
    updatedCount,
    sourceUrls,
    serviceCodes: [...new Set(records.map((record) => record.serviceCode))],
    autoCreatePrefectureCodes: [...autoCreatePrefectureCodes],
  };
}
