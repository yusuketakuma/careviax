import { Prisma, PrismaClient } from '@prisma/client';
import {
  FetchLike,
  SSK_IMPORT_URL_POLICY,
  ZipExpansionLimits,
  fetchBytes,
  fetchText,
  normalizeImportSourceUrl,
  resolveImportSourceUrl,
  unzipWithLimits,
} from './shared';

export const SSK_DRUG_MASTER_PAGE_URL =
  'https://www.ssk.or.jp/smph/seikyushiharai/tensuhyo/kihonmasta/kihonmasta_04.html';

const SSK_TOTAL_COLUMNS = 42;
const UPSERT_CHUNK_SIZE = 200;
const SSK_ZIP_EXPANSION_LIMITS: ZipExpansionLimits = {
  maxEntries: 20,
  maxEntryBytes: 128 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
};

const SSK_DOSAGE_FORM_MAP: Record<string, string> = {
  '1': '内用薬',
  '3': 'その他',
  '4': '注射薬',
  '6': '外用薬',
  '8': '歯科用薬剤',
};
const NEW_DRUG_MAX_ADMINISTRATION_DAYS = 14;
const ONE_YEAR_IN_DAYS = 365;

type ImportDbClient = Pick<PrismaClient, 'drugMaster' | 'drugMasterImportLog'>;

export type ParsedSskDrugMasterRecord = {
  receipt_code: string | null;
  yj_code: string;
  drug_name: string;
  drug_name_kana: string | null;
  generic_name: string | null;
  drug_price: Prisma.Decimal | null;
  unit: string | null;
  dosage_form: string | null;
  therapeutic_category: string | null;
  manufacturer: string | null;
  is_generic: boolean;
  is_narcotic: boolean;
  is_psychotropic: boolean;
  is_biologic: boolean;
  max_administration_days: number | null;
  transitional_expiry_date: Date | null;
  raw_row: string[];
};

export type ParsedSskDrugMasterFile = {
  entryName: string;
  zipUrl: string;
  records: ParsedSskDrugMasterRecord[];
};

export type ImportSskDrugMasterOptions = {
  zipUrl?: string;
  limit?: number;
  fetchImpl?: FetchLike;
  zipLimits?: Partial<ZipExpansionLimits>;
};

function normalizeCell(value: string | undefined) {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseSskDecimal(value: string | null) {
  if (!value || value === '0') return null;
  return new Prisma.Decimal(value);
}

function parseGenericName(value: string | null) {
  if (!value) return null;
  return value.replace(/^【般】/, '').trim() || null;
}

function parseSskDate(value: string | null) {
  if (!value || value === '0' || value === '99999999') return null;
  if (!/^\d{8}$/.test(value)) return null;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));

  return new Date(Date.UTC(year, month - 1, day));
}

function parseDosageForm(code: string | null) {
  if (!code) return null;
  return SSK_DOSAGE_FORM_MAP[code] ?? null;
}

function differenceInDays(from: Date, to: Date) {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

function parseMaxAdministrationDays(listedAt: Date | null, now = new Date()) {
  if (!listedAt) return null;

  const daysSinceListing = differenceInDays(listedAt, now);
  if (daysSinceListing < 0 || daysSinceListing > ONE_YEAR_IN_DAYS) {
    return null;
  }

  // New drugs are generally limited to 14 days for the first year after listing.
  return NEW_DRUG_MAX_ADMINISTRATION_DAYS;
}

function parseControlledDrugFlags(code: string | null) {
  return {
    is_narcotic: code === '1',
    is_psychotropic: code === '5',
  };
}

function mapSskRowToDrugMaster(row: string[]): ParsedSskDrugMasterRecord | null {
  if (row.length < SSK_TOTAL_COLUMNS) return null;

  const yjCode = normalizeCell(row[31]);
  const productName = normalizeCell(row[34]) ?? normalizeCell(row[4]);
  if (!yjCode || !productName) return null;
  const listedAt = parseSskDate(normalizeCell(row[35]));

  const controlledFlags = parseControlledDrugFlags(normalizeCell(row[13]));

  return {
    receipt_code: normalizeCell(row[2]),
    yj_code: yjCode,
    drug_name: productName,
    drug_name_kana: normalizeCell(row[6]),
    generic_name: parseGenericName(normalizeCell(row[37])),
    drug_price: parseSskDecimal(normalizeCell(row[11])),
    unit: normalizeCell(row[9]),
    dosage_form: parseDosageForm(normalizeCell(row[27])),
    therapeutic_category: yjCode.slice(0, 4) || null,
    manufacturer: null,
    is_generic: normalizeCell(row[16]) === '1',
    is_narcotic: controlledFlags.is_narcotic,
    is_psychotropic: controlledFlags.is_psychotropic,
    is_biologic: normalizeCell(row[15]) === '1',
    max_administration_days: parseMaxAdministrationDays(listedAt),
    transitional_expiry_date: parseSskDate(normalizeCell(row[33])),
    raw_row: row,
  };
}

function shouldReplaceRecord(
  current: ParsedSskDrugMasterRecord,
  candidate: ParsedSskDrugMasterRecord,
) {
  const currentSelection = current.drug_name.includes('（選）');
  const candidateSelection = candidate.drug_name.includes('（選）');

  if (currentSelection !== candidateSelection) {
    return currentSelection && !candidateSelection;
  }

  if (!current.generic_name && candidate.generic_name) {
    return true;
  }

  return false;
}

export function resolveLatestSskDrugMasterZipUrl(html: string, pageUrl = SSK_DRUG_MASTER_PAGE_URL) {
  const match = html.match(/<a\s+href="([^"]+\.zip)"[^>]*>\s*全件ファイル\(ZIP:[^<]+<\/a>/i);

  if (!match) {
    throw new Error('SSK医薬品全件マスターのZIPリンクを解決できませんでした');
  }

  return resolveImportSourceUrl(match[1], pageUrl, SSK_IMPORT_URL_POLICY);
}

function resolveSskZipLimits(overrides?: Partial<ZipExpansionLimits>) {
  return {
    ...SSK_ZIP_EXPANSION_LIMITS,
    ...overrides,
  };
}

function unzipSskDrugMasterArchive(buffer: Uint8Array, overrides?: Partial<ZipExpansionLimits>) {
  return unzipWithLimits(buffer, {
    sourceLabel: 'SSK医薬品マスター',
    limits: resolveSskZipLimits(overrides),
    filter: (entryName) => entryName.toLowerCase().endsWith('.csv'),
  });
}

export async function fetchLatestSskDrugMasterZip(
  fetchImpl: FetchLike = fetch,
  pageUrl = SSK_DRUG_MASTER_PAGE_URL,
  zipLimits?: Partial<ZipExpansionLimits>,
) {
  const html = await fetchText(pageUrl, {
    fetchImpl,
    policy: SSK_IMPORT_URL_POLICY,
  });
  const zipUrl = resolveLatestSskDrugMasterZipUrl(html, pageUrl);

  const zipBytes = new Uint8Array(
    await fetchBytes(zipUrl, {
      fetchImpl,
      policy: SSK_IMPORT_URL_POLICY,
    }),
  );
  return {
    zipUrl,
    entries: unzipSskDrugMasterArchive(zipBytes, zipLimits),
  };
}

export async function parseSskDrugMasterZip(
  options: Pick<ImportSskDrugMasterOptions, 'zipUrl' | 'limit' | 'fetchImpl' | 'zipLimits'> = {},
): Promise<ParsedSskDrugMasterFile> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const explicitZipUrl = options.zipUrl
    ? normalizeImportSourceUrl(options.zipUrl, SSK_IMPORT_URL_POLICY)
    : null;

  const zipPayload = explicitZipUrl
    ? {
        zipUrl: explicitZipUrl,
        entries: unzipSskDrugMasterArchive(
          new Uint8Array(
            await fetchBytes(explicitZipUrl, {
              fetchImpl,
              policy: SSK_IMPORT_URL_POLICY,
            }),
          ),
          options.zipLimits,
        ),
      }
    : await fetchLatestSskDrugMasterZip(fetchImpl, SSK_DRUG_MASTER_PAGE_URL, options.zipLimits);

  const entry = Object.entries(zipPayload.entries).find(([name]) =>
    name.toLowerCase().endsWith('.csv'),
  );

  if (!entry) {
    throw new Error('SSK ZIP内にCSVファイルが見つかりませんでした');
  }

  const [entryName, entryBytes] = entry;
  const csvText = new TextDecoder('shift_jis').decode(entryBytes);
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const deduped = new Map<string, ParsedSskDrugMasterRecord>();

  for (const line of lines) {
    const record = mapSskRowToDrugMaster(parseCsvLine(line));
    if (!record) continue;

    const current = deduped.get(record.yj_code);
    if (!current || shouldReplaceRecord(current, record)) {
      deduped.set(record.yj_code, record);
    }

    if (options.limit && deduped.size >= options.limit) {
      break;
    }
  }

  return {
    entryName,
    zipUrl: zipPayload.zipUrl,
    records: [...deduped.values()],
  };
}

async function upsertDrugMasterChunk(db: ImportDbClient, records: ParsedSskDrugMasterRecord[]) {
  await Promise.all(
    records.map((record) =>
      db.drugMaster.upsert({
        where: { yj_code: record.yj_code },
        create: {
          yj_code: record.yj_code,
          receipt_code: record.receipt_code,
          drug_name: record.drug_name,
          drug_name_kana: record.drug_name_kana,
          generic_name: record.generic_name,
          drug_price: record.drug_price,
          unit: record.unit,
          dosage_form: record.dosage_form,
          therapeutic_category: record.therapeutic_category,
          manufacturer: record.manufacturer,
          is_generic: record.is_generic,
          is_narcotic: record.is_narcotic,
          is_psychotropic: record.is_psychotropic,
          max_administration_days: record.max_administration_days,
          transitional_expiry_date: record.transitional_expiry_date,
        },
        update: {
          receipt_code: record.receipt_code,
          drug_name: record.drug_name,
          drug_name_kana: record.drug_name_kana,
          generic_name: record.generic_name,
          drug_price: record.drug_price,
          unit: record.unit,
          dosage_form: record.dosage_form,
          therapeutic_category: record.therapeutic_category,
          manufacturer: record.manufacturer,
          is_generic: record.is_generic,
          is_narcotic: record.is_narcotic,
          is_psychotropic: record.is_psychotropic,
          max_administration_days: record.max_administration_days,
          transitional_expiry_date: record.transitional_expiry_date,
        },
      }),
    ),
  );
}

export async function importSskDrugMaster(
  db: ImportDbClient,
  options: ImportSskDrugMasterOptions = {},
) {
  const log = await db.drugMasterImportLog.create({
    data: {
      source: 'ssk',
      status: 'running',
      record_count: 0,
    },
  });

  try {
    const parsed = await parseSskDrugMasterZip(options);

    for (let index = 0; index < parsed.records.length; index += UPSERT_CHUNK_SIZE) {
      await upsertDrugMasterChunk(db, parsed.records.slice(index, index + UPSERT_CHUNK_SIZE));
    }

    const completedLog = await db.drugMasterImportLog.update({
      where: { id: log.id },
      data: {
        status: 'completed',
        record_count: parsed.records.length,
      },
    });

    return {
      log: completedLog,
      entryName: parsed.entryName,
      zipUrl: parsed.zipUrl,
      importedCount: parsed.records.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SSK取込に失敗しました';
    await db.drugMasterImportLog.update({
      where: { id: log.id },
      data: {
        status: 'failed',
        error_log: message,
      },
    });
    throw error;
  }
}
