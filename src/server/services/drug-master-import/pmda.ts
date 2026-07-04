import { InteractionSeverity, InteractionSource } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';
import {
  decodeTextBuffer,
  FetchLike,
  PMDA_IMPORT_URL_POLICY,
  type DrugMasterImportLogDbClient,
  ZipExpansionLimits,
  fetchBytes,
  extractImportSourceDateFromUrl,
  isZipBuffer,
  normalizeCell,
  normalizeImportSourceUrl,
  normalizePreviewRowLimit,
  parseDate,
  sha256ImportPayload,
  unzipWithLimits,
  withImportLog,
} from './shared';

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

export type ImportPmdaPackageInsertOptions = {
  zipUrl?: string;
  mode?: 'full' | 'delta';
  fetchImpl?: FetchLike;
  zipLimits?: Partial<ZipExpansionLimits>;
};

export type PreviewPmdaPackageInsertOptions = ImportPmdaPackageInsertOptions & {
  previewLimit?: number;
};

type ParsedPmdaInteractionCandidate = {
  severity: InteractionSeverity;
  counterpart_names: string[];
  counterpart_yj_codes: string[];
  mechanism: string | null;
  clinical_effect: string | null;
};

type ParsedPmdaPackageInsertRecord = {
  yj_code: string | null;
  drug_name: string | null;
  document_version: string | null;
  revised_at: Date | null;
  contraindications: string[];
  interaction_summaries: {
    contraindicated: string[];
    caution: string[];
  };
  adverse_effects: string[];
  dosage_and_administration: string[];
  interaction_candidates: ParsedPmdaInteractionCandidate[];
};
type PmdaPackageInsertImportDbClient = DrugMasterImportLogDbClient & {
  drugInteraction: Pick<Prisma.TransactionClient['drugInteraction'], 'upsert'>;
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany'>;
  drugPackageInsert: Pick<
    Prisma.TransactionClient['drugPackageInsert'],
    'create' | 'findFirst' | 'update'
  >;
};
type PmdaPackageInsertPreviewDbClient = {
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany'>;
  drugPackageInsert: Pick<Prisma.TransactionClient['drugPackageInsert'], 'findMany'>;
};

type PmdaPackageInsertPreviewAction = 'create' | 'update' | 'unchanged' | 'skip_unmatched_primary';

export type PmdaPackageInsertPreviewRow = {
  yj_code: string | null;
  drug_name: string | null;
  drug_master_id: string | null;
  action: PmdaPackageInsertPreviewAction;
  changed_fields: string[];
  interaction_candidate_count: number;
  matched_interaction_pair_count: number;
};

export type PmdaPackageInsertImportPreview = {
  dryRun: true;
  zipUrl: string;
  mode: 'full' | 'delta';
  sourceFileHash: string;
  sourcePublishedAt: string | null;
  preview: {
    summary: {
      parsed_records: number;
      matched_primary_records: number;
      skipped_unmatched_primary_records: number;
      create_count: number;
      update_count: number;
      unchanged_count: number;
      matched_interaction_pair_count: number;
      sampled_rows: number;
    };
    rows: PmdaPackageInsertPreviewRow[];
  };
};

const PMDA_FULL_URL_ENV = 'PMDA_PACKAGE_INSERT_FULL_URL';
const PMDA_DELTA_URL_ENV = 'PMDA_PACKAGE_INSERT_DELTA_URL';
const PMDA_ZIP_EXPANSION_LIMITS: ZipExpansionLimits = {
  maxEntries: 80_000,
  maxEntryBytes: 8 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
};

function resolvePmdaArchiveUrl(options: ImportPmdaPackageInsertOptions) {
  if (options.zipUrl) {
    return normalizeImportSourceUrl(options.zipUrl, PMDA_IMPORT_URL_POLICY);
  }

  const envKey = options.mode === 'delta' ? PMDA_DELTA_URL_ENV : PMDA_FULL_URL_ENV;
  const configured = process.env[envKey];
  if (!configured) {
    throw new Error(
      `PMDA 添付文書 ZIP URL が未設定です。${envKey} または zipUrl を指定してください`,
    );
  }
  return normalizeImportSourceUrl(configured, PMDA_IMPORT_URL_POLICY);
}

function resolvePmdaZipLimits(overrides?: Partial<ZipExpansionLimits>) {
  return {
    ...PMDA_ZIP_EXPANSION_LIMITS,
    ...overrides,
  };
}

function unzipPmdaPackageInsertArchive(
  buffer: Uint8Array,
  overrides?: Partial<ZipExpansionLimits>,
) {
  return unzipWithLimits(buffer, {
    sourceLabel: 'PMDA添付文書',
    limits: resolvePmdaZipLimits(overrides),
    filter: (entryName) => entryName.toLowerCase().endsWith('.xml'),
  });
}

function walkNode(
  node: unknown,
  visit: (value: unknown, key: string | null, path: string[]) => void,
  path: string[] = [],
  key: string | null = null,
) {
  visit(node, key, path);

  if (Array.isArray(node)) {
    node.forEach((value, index) => walkNode(value, visit, [...path, String(index)], key));
    return;
  }

  if (node && typeof node === 'object') {
    for (const [childKey, value] of Object.entries(node)) {
      walkNode(value, visit, [...path, childKey], childKey);
    }
  }
}

function collectLeafTexts(node: unknown) {
  const values: string[] = [];
  walkNode(node, (value) => {
    if (typeof value !== 'string') return;
    const normalized = normalizeCell(value);
    if (!normalized) return;
    values.push(normalized);
  });
  return [...new Set(values)];
}

function matchesAny(value: string | null, patterns: RegExp[]) {
  if (!value) return false;
  return patterns.some((pattern) => pattern.test(value));
}

function firstMatchingText(node: unknown, patterns: RegExp[]) {
  const values: string[] = [];
  walkNode(node, (value, key) => {
    if (typeof value !== 'string' || !matchesAny(key, patterns)) return;
    const normalized = normalizeCell(value);
    if (normalized) {
      values.push(normalized);
    }
  });
  return values[0] ?? null;
}

function collectMatchingTexts(node: unknown, patterns: RegExp[]) {
  const values: string[] = [];
  walkNode(node, (value, key) => {
    if (typeof value !== 'string') return;
    if (!matchesAny(key, patterns)) return;
    const normalized = normalizeCell(value);
    if (!normalized) return;
    values.push(normalized);
  });
  return [...new Set(values)];
}

function collectSectionsByTitle(node: unknown, titlePatterns: RegExp[]) {
  const sections: Array<{ title: string; value: unknown }> = [];

  walkNode(node, (value, key) => {
    if (key && matchesAny(key, titlePatterns)) {
      sections.push({ title: key, value });
      return;
    }

    if (!value || typeof value !== 'object') return;
    const title = firstMatchingText(value, [
      /title/i,
      /heading/i,
      /section.?title/i,
      /name/i,
      /項目名/,
      /見出し/,
      /title_ja/i,
    ]);

    if (matchesAny(title, titlePatterns)) {
      sections.push({ title: title!, value });
    }
  });

  return sections;
}

function summarizeSection(node: unknown, limit = 25) {
  return collectLeafTexts(node)
    .filter((value) => value.length <= 300)
    .slice(0, limit);
}

function extractInteractionCandidates(
  node: unknown,
  severity: InteractionSeverity,
): ParsedPmdaInteractionCandidate[] {
  const candidates: ParsedPmdaInteractionCandidate[] = [];

  walkNode(node, (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;

    const counterpartNames = collectMatchingTexts(value, [
      /併用薬剤/,
      /相手薬剤/,
      /薬剤名/,
      /販売名/,
      /医薬品名/,
    ]).filter((name) => !/併用禁忌|併用注意|禁忌/.test(name));

    const counterpartCodes = collectMatchingTexts(value, [
      /薬価基準収載医薬品コード/,
      /YJ/i,
      /drug.?code/i,
    ]).filter((code) => /^\d{12}$/.test(code));

    if (counterpartNames.length === 0 && counterpartCodes.length === 0) {
      return;
    }

    candidates.push({
      severity,
      counterpart_names: counterpartNames,
      counterpart_yj_codes: counterpartCodes,
      mechanism:
        firstMatchingText(value, [/機序/, /危険因子/, /mechanism/i]) ??
        firstMatchingText(value, [/説明/, /comment/i]),
      clinical_effect:
        firstMatchingText(value, [/臨床症状/, /措置方法/, /影響/, /effect/i]) ?? null,
    });
  });

  return dedupeInteractionCandidates(candidates);
}

function dedupeInteractionCandidates(candidates: ParsedPmdaInteractionCandidate[]) {
  const seen = new Set<string>();
  const deduped: ParsedPmdaInteractionCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.severity}:${candidate.counterpart_yj_codes.sort().join('|')}:${candidate.counterpart_names.sort().join('|')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

function parsePmdaXmlDocument(xmlText: string): ParsedPmdaPackageInsertRecord {
  const xml = parser.parse(xmlText);
  const contraindicationSections = collectSectionsByTitle(xml, [/禁忌/]);
  const contraindicatedInteractionSections = collectSectionsByTitle(xml, [/併用禁忌/]);
  const cautionInteractionSections = collectSectionsByTitle(xml, [/併用注意/]);
  const adverseSections = collectSectionsByTitle(xml, [/重大な副作用/]);
  const dosageSections = collectSectionsByTitle(xml, [/用法及び用量/, /用法用量/]);

  return {
    yj_code: firstMatchingText(xml, [/薬価基準収載医薬品コード/, /YJ/i, /drug.?code/i]) ?? null,
    drug_name: firstMatchingText(xml, [/販売名/, /品名/, /医薬品名/, /drug.?name/i]) ?? null,
    document_version: firstMatchingText(xml, [/版/, /version/i, /文書番号/, /document/i]) ?? null,
    revised_at:
      parseDate(firstMatchingText(xml, [/改訂年月/, /改訂日/, /作成又は改訂年月日/])) ?? null,
    contraindications: contraindicationSections.flatMap((section) =>
      summarizeSection(section.value),
    ),
    interaction_summaries: {
      contraindicated: contraindicatedInteractionSections.flatMap((section) =>
        summarizeSection(section.value),
      ),
      caution: cautionInteractionSections.flatMap((section) => summarizeSection(section.value)),
    },
    adverse_effects: adverseSections.flatMap((section) => summarizeSection(section.value)),
    dosage_and_administration: dosageSections.flatMap((section) => summarizeSection(section.value)),
    interaction_candidates: [
      ...contraindicatedInteractionSections.flatMap((section) =>
        extractInteractionCandidates(section.value, 'contraindicated'),
      ),
      ...cautionInteractionSections.flatMap((section) =>
        extractInteractionCandidates(section.value, 'caution'),
      ),
    ],
  };
}

export async function parsePmdaPackageInsertArchive(options: ImportPmdaPackageInsertOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const zipUrl = resolvePmdaArchiveUrl(options);
  const buffer = await fetchBytes(zipUrl, {
    fetchImpl,
    policy: PMDA_IMPORT_URL_POLICY,
  });
  const records: ParsedPmdaPackageInsertRecord[] = [];

  if (isZipBuffer(buffer) && !zipUrl.toLowerCase().endsWith('.xml')) {
    const entries = unzipPmdaPackageInsertArchive(new Uint8Array(buffer), options.zipLimits);
    for (const [entryName, bytes] of Object.entries(entries)) {
      if (!/\.xml$/i.test(entryName)) continue;
      const xmlText = decodeTextBuffer(Buffer.from(bytes));
      records.push(parsePmdaXmlDocument(xmlText));
    }
  } else {
    records.push(parsePmdaXmlDocument(decodeTextBuffer(buffer)));
  }

  return {
    zipUrl,
    sourceFileHash: sha256ImportPayload(buffer),
    mode: options.mode ?? 'full',
    records,
  };
}

function canonicalizePair(aId: string, bId: string) {
  return aId <= bId ? [aId, bId] : [bId, aId];
}

function matchCounterpartIds(
  candidate: ParsedPmdaInteractionCandidate,
  masterIdByYjCode: Map<string, string>,
) {
  const matched = new Map<string, string>();

  for (const code of candidate.counterpart_yj_codes) {
    const masterId = masterIdByYjCode.get(code);
    if (masterId) {
      matched.set(masterId, masterId);
    }
  }

  return [...matched.keys()];
}

function comparablePreviewValue(value: unknown) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return comparablePreviewValue(value);
}

function isPreviewValueEqual(left: unknown, right: unknown) {
  return stableStringify(left) === stableStringify(right);
}

function changedPmdaPackageInsertFields(
  record: ParsedPmdaPackageInsertRecord,
  existing: {
    contraindications: Prisma.JsonValue | null;
    interactions: Prisma.JsonValue | null;
    adverse_effects: Prisma.JsonValue | null;
    document_version: string | null;
    revised_at: Date | null;
    source_format: string | null;
  },
) {
  const comparisons: Array<{ field: string; next: unknown; current: unknown }> = [
    {
      field: 'contraindications',
      next: record.contraindications,
      current: existing.contraindications,
    },
    {
      field: 'interactions',
      next: record.interaction_summaries,
      current: existing.interactions,
    },
    {
      field: 'adverse_effects',
      next: record.adverse_effects,
      current: existing.adverse_effects,
    },
    {
      field: 'document_version',
      next: record.document_version,
      current: existing.document_version,
    },
    {
      field: 'revised_at',
      next: record.revised_at,
      current: existing.revised_at,
    },
    {
      field: 'source_format',
      next: 'xml',
      current: existing.source_format,
    },
  ];

  return comparisons
    .filter((comparison) => !isPreviewValueEqual(comparison.next, comparison.current))
    .map((comparison) => comparison.field);
}

function matchedInteractionPairCount(args: {
  primaryId: string;
  interactionCandidates: ParsedPmdaInteractionCandidate[];
  masterIdByYjCode: Map<string, string>;
}) {
  const pairs = new Set<string>();
  for (const candidate of args.interactionCandidates) {
    const counterpartIds = matchCounterpartIds(candidate, args.masterIdByYjCode).filter(
      (id) => id !== args.primaryId,
    );
    for (const counterpartId of counterpartIds) {
      const [drugAId, drugBId] = canonicalizePair(args.primaryId, counterpartId);
      pairs.add(`${drugAId}:${drugBId}`);
    }
  }
  return pairs.size;
}

async function fetchLatestPackageInsertByMasterId(
  db: PmdaPackageInsertPreviewDbClient,
  drugMasterIds: string[],
) {
  if (drugMasterIds.length === 0) {
    return new Map<string, Awaited<ReturnType<typeof db.drugPackageInsert.findMany>>[number]>();
  }

  const rows = await db.drugPackageInsert.findMany({
    where: { drug_master_id: { in: drugMasterIds } },
    orderBy: [{ drug_master_id: 'asc' }, { revised_at: 'desc' }, { created_at: 'desc' }],
    select: {
      id: true,
      drug_master_id: true,
      contraindications: true,
      interactions: true,
      adverse_effects: true,
      document_version: true,
      revised_at: true,
      source_format: true,
      created_at: true,
    },
  });

  const latestByMasterId = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latestByMasterId.has(row.drug_master_id)) {
      latestByMasterId.set(row.drug_master_id, row);
    }
  }
  return latestByMasterId;
}

export async function previewPmdaPackageInserts(
  db: PmdaPackageInsertPreviewDbClient,
  options: PreviewPmdaPackageInsertOptions = {},
): Promise<PmdaPackageInsertImportPreview> {
  const parsed = await parsePmdaPackageInsertArchive(options);
  const previewLimit = normalizePreviewRowLimit(options.previewLimit);
  const masters = await db.drugMaster.findMany({
    select: {
      id: true,
      yj_code: true,
      drug_name: true,
      generic_name: true,
    },
  });
  const mastersByYjCode = new Map(masters.map((item) => [item.yj_code, item]));
  const masterIdByYjCode = new Map(masters.map((item) => [item.yj_code, item.id]));
  const matchedMasterIds = [
    ...new Set(
      parsed.records
        .map((record) => (record.yj_code ? mastersByYjCode.get(record.yj_code)?.id : null))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const latestPackageInsertByMasterId = await fetchLatestPackageInsertByMasterId(
    db,
    matchedMasterIds,
  );

  let matchedPrimaryCount = 0;
  let skippedUnmatchedPrimaryCount = 0;
  let createCount = 0;
  let updateCount = 0;
  let unchangedCount = 0;
  let matchedPairCount = 0;
  const rows: PmdaPackageInsertPreviewRow[] = [];

  for (const record of parsed.records) {
    const primary = record.yj_code ? mastersByYjCode.get(record.yj_code) : null;
    if (!primary) {
      skippedUnmatchedPrimaryCount += 1;
      if (rows.length < previewLimit) {
        rows.push({
          yj_code: record.yj_code,
          drug_name: record.drug_name,
          drug_master_id: null,
          action: 'skip_unmatched_primary',
          changed_fields: [],
          interaction_candidate_count: record.interaction_candidates.length,
          matched_interaction_pair_count: 0,
        });
      }
      continue;
    }

    matchedPrimaryCount += 1;
    const recordMatchedPairCount = matchedInteractionPairCount({
      primaryId: primary.id,
      interactionCandidates: record.interaction_candidates,
      masterIdByYjCode,
    });
    matchedPairCount += recordMatchedPairCount;
    const existing = latestPackageInsertByMasterId.get(primary.id);
    if (!existing) {
      createCount += 1;
      if (rows.length < previewLimit) {
        rows.push({
          yj_code: record.yj_code,
          drug_name: record.drug_name ?? primary.drug_name,
          drug_master_id: primary.id,
          action: 'create',
          changed_fields: [
            'contraindications',
            'interactions',
            'adverse_effects',
            'document_version',
            'revised_at',
            'source_format',
          ],
          interaction_candidate_count: record.interaction_candidates.length,
          matched_interaction_pair_count: recordMatchedPairCount,
        });
      }
      continue;
    }

    const changedFields = changedPmdaPackageInsertFields(record, existing);
    if (changedFields.length === 0) {
      unchangedCount += 1;
      continue;
    }

    updateCount += 1;
    if (rows.length < previewLimit) {
      rows.push({
        yj_code: record.yj_code,
        drug_name: record.drug_name ?? primary.drug_name,
        drug_master_id: primary.id,
        action: 'update',
        changed_fields: changedFields,
        interaction_candidate_count: record.interaction_candidates.length,
        matched_interaction_pair_count: recordMatchedPairCount,
      });
    }
  }

  return {
    dryRun: true,
    zipUrl: parsed.zipUrl,
    mode: parsed.mode,
    sourceFileHash: parsed.sourceFileHash,
    sourcePublishedAt:
      extractImportSourceDateFromUrl(parsed.zipUrl, [
        /(?:^|[^\d])(\d{8})(?:[^\d]|$)/,
      ])?.toISOString() ?? null,
    preview: {
      summary: {
        parsed_records: parsed.records.length,
        matched_primary_records: matchedPrimaryCount,
        skipped_unmatched_primary_records: skippedUnmatchedPrimaryCount,
        create_count: createCount,
        update_count: updateCount,
        unchanged_count: unchangedCount,
        matched_interaction_pair_count: matchedPairCount,
        sampled_rows: rows.length,
      },
      rows,
    },
  };
}

export async function importPmdaPackageInserts(
  db: PmdaPackageInsertImportDbClient,
  options: ImportPmdaPackageInsertOptions = {},
) {
  return withImportLog(db, 'pmda', async () => {
    const parsed = await parsePmdaPackageInsertArchive(options);
    const masters = await db.drugMaster.findMany({
      select: {
        id: true,
        yj_code: true,
        drug_name: true,
        generic_name: true,
      },
    });

    let importedCount = 0;
    let skippedUnmatchedPrimaryCount = 0;
    let createCount = 0;
    let updateCount = 0;
    let unchangedCount = 0;
    let matchedPairCount = 0;
    const mastersByYjCode = new Map(masters.map((item) => [item.yj_code, item]));
    const masterIdByYjCode = new Map(masters.map((item) => [item.yj_code, item.id]));

    for (const record of parsed.records) {
      const primary = record.yj_code ? mastersByYjCode.get(record.yj_code) : null;
      if (!primary) {
        skippedUnmatchedPrimaryCount += 1;
        continue;
      }

      const latest = await db.drugPackageInsert.findFirst({
        where: { drug_master_id: primary.id },
        orderBy: [{ revised_at: 'desc' }, { created_at: 'desc' }],
        select: {
          id: true,
          contraindications: true,
          interactions: true,
          adverse_effects: true,
          document_version: true,
          revised_at: true,
          source_format: true,
        },
      });

      if (latest) {
        const changedFields = changedPmdaPackageInsertFields(record, latest);
        if (changedFields.length > 0) {
          await db.drugPackageInsert.update({
            where: { id: latest.id },
            data: {
              contraindications: record.contraindications,
              interactions: record.interaction_summaries,
              adverse_effects: record.adverse_effects,
              document_version: record.document_version,
              revised_at: record.revised_at,
              source_format: 'xml',
            },
          });
          updateCount += 1;
        } else {
          unchangedCount += 1;
        }
      } else {
        await db.drugPackageInsert.create({
          data: {
            drug_master_id: primary.id,
            contraindications: record.contraindications,
            interactions: record.interaction_summaries,
            adverse_effects: record.adverse_effects,
            document_version: record.document_version,
            revised_at: record.revised_at,
            source_format: 'xml',
          },
        });
        createCount += 1;
      }

      const recordMatchedPairCount = matchedInteractionPairCount({
        primaryId: primary.id,
        interactionCandidates: record.interaction_candidates,
        masterIdByYjCode,
      });
      matchedPairCount += recordMatchedPairCount;

      for (const candidate of record.interaction_candidates) {
        const counterpartIds = matchCounterpartIds(candidate, masterIdByYjCode).filter(
          (id) => id !== primary.id,
        );

        for (const counterpartId of counterpartIds) {
          const [drugAId, drugBId] = canonicalizePair(primary.id, counterpartId);
          await db.drugInteraction.upsert({
            where: {
              drug_a_id_drug_b_id_source: {
                drug_a_id: drugAId,
                drug_b_id: drugBId,
                source: InteractionSource.pmda_xml,
              },
            },
            create: {
              drug_a_id: drugAId,
              drug_b_id: drugBId,
              severity: candidate.severity,
              mechanism: candidate.mechanism,
              clinical_effect: candidate.clinical_effect,
              source: InteractionSource.pmda_xml,
            },
            update: {
              severity: candidate.severity,
              mechanism: candidate.mechanism,
              clinical_effect: candidate.clinical_effect,
            },
          });
        }
      }

      importedCount += 1;
    }

    return {
      recordCount: importedCount,
      sourceUrl: parsed.zipUrl,
      sourceFileHash: parsed.sourceFileHash,
      sourcePublishedAt: extractImportSourceDateFromUrl(parsed.zipUrl, [
        /(?:^|[^\d])(\d{8})(?:[^\d]|$)/,
      ]),
      importMode: parsed.mode,
      changeSummary: {
        mode: parsed.mode,
        parsed_records: parsed.records.length,
        imported_records: importedCount,
        skipped_unmatched_primary_records: skippedUnmatchedPrimaryCount,
        create_count: createCount,
        update_count: updateCount,
        unchanged_count: unchangedCount,
        matched_interaction_pair_count: matchedPairCount,
      },
      payload: {
        zipUrl: parsed.zipUrl,
        mode: parsed.mode,
      },
    };
  });
}
