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
  isZipBuffer,
  normalizeCell,
  normalizeImportSourceUrl,
  parseDate,
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
    mode: options.mode ?? 'full',
    records,
  };
}

function canonicalizePair(aId: string, bId: string) {
  return aId <= bId ? [aId, bId] : [bId, aId];
}

function matchCounterpartIds(
  candidate: ParsedPmdaInteractionCandidate,
  masters: Array<{
    id: string;
    yj_code: string;
    drug_name: string;
    generic_name: string | null;
  }>,
) {
  const matched = new Map<string, string>();

  for (const code of candidate.counterpart_yj_codes) {
    const master = masters.find((item) => item.yj_code === code);
    if (master) {
      matched.set(master.id, master.id);
    }
  }

  for (const name of candidate.counterpart_names) {
    const master = masters.find(
      (item) =>
        item.drug_name === name ||
        item.drug_name.includes(name) ||
        item.generic_name === name ||
        name.includes(item.drug_name),
    );
    if (master) {
      matched.set(master.id, master.id);
    }
  }

  return [...matched.keys()];
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

    for (const record of parsed.records) {
      const primary =
        (record.yj_code ? masters.find((item) => item.yj_code === record.yj_code) : null) ??
        (record.drug_name
          ? masters.find(
              (item) =>
                item.drug_name === record.drug_name || item.drug_name.includes(record.drug_name!),
            )
          : null);

      if (!primary) {
        continue;
      }

      const latest = await db.drugPackageInsert.findFirst({
        where: { drug_master_id: primary.id },
        orderBy: [{ revised_at: 'desc' }, { created_at: 'desc' }],
        select: { id: true },
      });

      if (latest) {
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
      }

      for (const candidate of record.interaction_candidates) {
        const counterpartIds = matchCounterpartIds(candidate, masters).filter(
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
      payload: {
        zipUrl: parsed.zipUrl,
        mode: parsed.mode,
      },
    };
  });
}
