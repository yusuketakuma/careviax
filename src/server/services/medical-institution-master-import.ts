import type { PrismaClient } from '@prisma/client';
import {
  decodeTextBuffer,
  fetchBytes,
  fetchText,
  normalizeCell,
  parseDelimitedRows,
  readDelimitedCell,
  resolveImportSourceUrl,
  stripBom,
  unzipWithLimits,
  type FetchLike,
  type ImportSourceUrlPolicy,
} from '@/server/services/import-source/shared';

const BYTES_PER_MIB = 1024 * 1024;
const MEDICAL_INSTITUTION_SOURCE = 'mhlw_medical_institution';

export const MHLW_MEDICAL_OPEN_DATA_PAGE_URL =
  'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryou/newpage_43373.html';

export const MHLW_MEDICAL_INSTITUTION_IMPORT_URL_POLICY: ImportSourceUrlPolicy<
  typeof MEDICAL_INSTITUTION_SOURCE
> = {
  source: MEDICAL_INSTITUTION_SOURCE,
  allowedHosts: ['www.mhlw.go.jp'],
  maxBytes: 128 * BYTES_PER_MIB,
};

const ZIP_LIMITS = {
  maxEntries: 8,
  maxEntryBytes: 80 * BYTES_PER_MIB,
  maxTotalBytes: 160 * BYTES_PER_MIB,
};

type MedicalInstitutionImportDbClient = {
  organization: Pick<PrismaClient['organization'], 'findMany'>;
  prescriberInstitution: Pick<
    PrismaClient['prescriberInstitution'],
    'findMany' | 'update' | 'create'
  >;
};

type MedicalInstitutionSourceKind = 'hospital' | 'clinic';

type MedicalInstitutionRecord = {
  sourceCode: string;
  sourceKind: MedicalInstitutionSourceKind;
  name: string;
  prefectureCode: string | null;
  address: string | null;
  phone: string | null;
  fax: string | null;
};

type ExistingInstitution = {
  id: string;
  name: string;
  institution_code: string | null;
  address: string | null;
  phone: string | null;
  fax: string | null;
};

type ImportOptions = {
  sourceUrls?: string[];
  targetOrgIds?: string[];
  autoCreatePrefectureCodes?: string[];
  fetchImpl?: FetchLike;
};

type SourceUrlCandidate = {
  url: string;
  kind: MedicalInstitutionSourceKind;
  snapshotDate: string;
};

function normalizeSourceCode(value: string | null) {
  return normalizeCell(value)?.replace(/[^\dA-Za-z_-]/g, '') ?? null;
}

function normalizePhoneLike(value: string | null) {
  const normalized = normalizeCell(value);
  if (!normalized) return null;
  return normalized.replace(/[^\d+()-]/g, '') || normalized;
}

function headerIndex(headers: string[], ...aliases: string[]) {
  return headers.findIndex((header) => aliases.some((alias) => header === alias));
}

function findOptionalHeaderIndex(headers: string[], predicate: (header: string) => boolean) {
  return headers.findIndex(predicate);
}

export function parseMedicalInstitutionFacilityCsv(
  text: string,
  sourceKind: MedicalInstitutionSourceKind,
) {
  const rows = parseDelimitedRows(text);
  const headers = rows[0]?.map((header) => stripBom(header).replace(/^"|"$/g, '').trim()) ?? [];
  const idIndex = headerIndex(headers, 'ID');
  const nameIndex = headerIndex(headers, '正式名称');
  const prefectureIndex = headerIndex(headers, '都道府県コード');
  const addressIndex = headerIndex(headers, '所在地');
  const phoneIndex = findOptionalHeaderIndex(headers, (header) => /電話番号/.test(header));
  const faxIndex = findOptionalHeaderIndex(headers, (header) => /FAX|ＦＡＸ|ファクス/.test(header));

  if (idIndex < 0 || nameIndex < 0) {
    throw new Error('医療機関オープンデータCSVに必要な ID / 正式名称 ヘッダーがありません');
  }

  return rows.slice(1).flatMap((row): MedicalInstitutionRecord[] => {
    const sourceCode = normalizeSourceCode(readDelimitedCell(row, idIndex));
    const name = normalizeCell(readDelimitedCell(row, nameIndex));
    if (!sourceCode || !name) return [];

    return [
      {
        sourceCode,
        sourceKind,
        name,
        prefectureCode: normalizeCell(readDelimitedCell(row, prefectureIndex)),
        address: normalizeCell(readDelimitedCell(row, addressIndex)),
        phone: normalizePhoneLike(readDelimitedCell(row, phoneIndex)),
        fax: normalizePhoneLike(readDelimitedCell(row, faxIndex)),
      },
    ];
  });
}

function inferSourceKind(urlOrEntryName: string): MedicalInstitutionSourceKind | null {
  const normalized = urlOrEntryName.toLowerCase();
  if (normalized.includes('hospital_facility_info')) return 'hospital';
  if (normalized.includes('clinic_facility_info')) return 'clinic';
  return null;
}

export function resolveLatestMedicalInstitutionFacilityUrls(
  html: string,
  pageUrl = MHLW_MEDICAL_OPEN_DATA_PAGE_URL,
) {
  const candidates: SourceUrlCandidate[] = [];
  const matches = html.matchAll(/href="([^"]*(hospital|clinic)_facility_info_(\d{8})\.zip)"/gi);

  for (const match of matches) {
    const kind = match[2]?.toLowerCase() === 'hospital' ? 'hospital' : 'clinic';
    candidates.push({
      url: resolveImportSourceUrl(match[1], pageUrl, MHLW_MEDICAL_INSTITUTION_IMPORT_URL_POLICY),
      kind,
      snapshotDate: match[3],
    });
  }

  const latestDate = candidates.reduce<string | null>(
    (latest, candidate) =>
      latest == null || candidate.snapshotDate > latest ? candidate.snapshotDate : latest,
    null,
  );
  if (!latestDate) {
    throw new Error('最新の医療機関オープンデータZIPを解決できませんでした');
  }

  const latest = candidates.filter((candidate) => candidate.snapshotDate === latestDate);
  const byKind = new Map<MedicalInstitutionSourceKind, SourceUrlCandidate>();
  for (const candidate of latest) {
    byKind.set(candidate.kind, candidate);
  }

  return Array.from(byKind.values()).map((candidate) => candidate.url);
}

async function resolveSourceUrls(options: ImportOptions) {
  const explicitUrls = options.sourceUrls?.map((url) =>
    resolveImportSourceUrl(
      url,
      MHLW_MEDICAL_OPEN_DATA_PAGE_URL,
      MHLW_MEDICAL_INSTITUTION_IMPORT_URL_POLICY,
    ),
  );
  if (explicitUrls && explicitUrls.length > 0) return explicitUrls;

  const html = await fetchText(MHLW_MEDICAL_OPEN_DATA_PAGE_URL, {
    fetchImpl: options.fetchImpl,
    policy: MHLW_MEDICAL_INSTITUTION_IMPORT_URL_POLICY,
  });
  return resolveLatestMedicalInstitutionFacilityUrls(html);
}

function normalizePrefectureCodes(codes: string[] | undefined) {
  const source =
    codes ?? process.env.MEDICAL_INSTITUTION_MASTER_AUTO_CREATE_PREFECTURE_CODES?.split(',') ?? [];
  return new Set(
    source
      .map((code) => code.trim())
      .filter(Boolean)
      .map((code) => code.padStart(2, '0')),
  );
}

async function parseSourceUrl(url: string, options: ImportOptions) {
  const buffer = await fetchBytes(url, {
    fetchImpl: options.fetchImpl,
    policy: MHLW_MEDICAL_INSTITUTION_IMPORT_URL_POLICY,
  });
  const urlKind = inferSourceKind(url);

  if (!url.toLowerCase().endsWith('.zip')) {
    if (!urlKind) throw new Error('医療機関オープンデータ種別をURLから判定できませんでした');
    return parseMedicalInstitutionFacilityCsv(decodeTextBuffer(buffer), urlKind);
  }

  const entries = unzipWithLimits(buffer, {
    sourceLabel: '医療機関オープンデータ',
    limits: ZIP_LIMITS,
    filter: (entryName) => /\.(csv|txt)$/i.test(entryName),
  });

  const records: MedicalInstitutionRecord[] = [];
  for (const [entryName, entryBytes] of Object.entries(entries)) {
    const kind = inferSourceKind(entryName) ?? urlKind;
    if (!kind) continue;
    records.push(
      ...parseMedicalInstitutionFacilityCsv(decodeTextBuffer(Buffer.from(entryBytes)), kind),
    );
  }

  if (records.length === 0) {
    throw new Error('医療機関オープンデータZIP内に施設票CSVが見つかりませんでした');
  }
  return records;
}

function uniqueBySourceCode(records: MedicalInstitutionRecord[]) {
  const map = new Map<string, MedicalInstitutionRecord>();
  for (const record of records) {
    const existing = map.get(record.sourceCode);
    if (!existing || (!existing.address && record.address)) {
      map.set(record.sourceCode, record);
    }
  }
  return Array.from(map.values());
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

function buildUpdateData(existing: ExistingInstitution, record: MedicalInstitutionRecord) {
  const data: Partial<
    Pick<ExistingInstitution, 'name' | 'institution_code' | 'address' | 'phone' | 'fax'>
  > = {};

  if (existing.institution_code !== record.sourceCode) data.institution_code = record.sourceCode;
  if (existing.name !== record.name) data.name = record.name;
  if (record.address && existing.address !== record.address) data.address = record.address;
  if (record.phone && existing.phone !== record.phone) data.phone = record.phone;
  if (record.fax && existing.fax !== record.fax) data.fax = record.fax;

  return data;
}

export async function importMedicalInstitutionOpenData(
  db: MedicalInstitutionImportDbClient,
  options: ImportOptions = {},
) {
  const sourceUrls = await resolveSourceUrls(options);
  const autoCreatePrefectureCodes = normalizePrefectureCodes(options.autoCreatePrefectureCodes);
  const records = uniqueBySourceCode(
    (await Promise.all(sourceUrls.map((url) => parseSourceUrl(url, options)))).flat(),
  );
  const recordByCode = new Map(records.map((record) => [record.sourceCode, record]));
  const recordByUniqueName = singleValueMap(records, (record) => record.name);

  const organizations = await db.organization.findMany({
    where: options.targetOrgIds ? { id: { in: options.targetOrgIds } } : undefined,
    select: { id: true },
  });

  let createdCount = 0;
  let updatedCount = 0;
  let matchedCount = 0;

  for (const organization of organizations) {
    const existing = await db.prescriberInstitution.findMany({
      where: { org_id: organization.id },
      select: {
        id: true,
        name: true,
        institution_code: true,
        address: true,
        phone: true,
        fax: true,
      },
    });
    const existingByCode = new Map(
      existing.flatMap((item) => (item.institution_code ? [[item.institution_code, item]] : [])),
    );
    const knownCodes = new Set(existingByCode.keys());
    const knownNames = new Set(existing.map((item) => item.name));
    const seenExistingIds = new Set<string>();

    for (const item of existing) {
      const record =
        (item.institution_code ? recordByCode.get(item.institution_code) : undefined) ??
        recordByUniqueName.get(item.name);
      if (!record || seenExistingIds.has(item.id)) continue;
      seenExistingIds.add(item.id);
      matchedCount++;

      const data = buildUpdateData(item, record);
      if (Object.keys(data).length === 0) continue;
      await db.prescriberInstitution.update({
        where: { id: item.id },
        data,
      });
      updatedCount++;
    }

    if (autoCreatePrefectureCodes.size === 0) continue;

    for (const record of records) {
      if (!record.prefectureCode || !autoCreatePrefectureCodes.has(record.prefectureCode)) continue;
      if (knownCodes.has(record.sourceCode)) continue;
      if (knownNames.has(record.name)) continue;

      await db.prescriberInstitution.create({
        data: {
          org_id: organization.id,
          name: record.name,
          institution_code: record.sourceCode,
          address: record.address,
          phone: record.phone,
          fax: record.fax,
          notes: `MHLW medical open data auto-created (${record.sourceKind})`,
        },
      });
      knownCodes.add(record.sourceCode);
      knownNames.add(record.name);
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
    autoCreatePrefectureCodes: Array.from(autoCreatePrefectureCodes),
  };
}
