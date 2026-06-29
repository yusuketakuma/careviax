import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { internalError, success, notFound, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObject } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';

/**
 * GET /api/drug-masters/:id/package-insert
 *
 * Returns the latest package insert for a drug, with all sections
 * structured for display. Also returns drug interactions and alert rules.
 */

const ROUTE = '/api/drug-masters/[id]/package-insert';
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
]);

function safeErrorName(err: unknown): string {
  if (!(err instanceof Error)) return 'Error';
  return SAFE_ERROR_NAMES.has(err.name) ? err.name : 'Error';
}

export type DrugPackageInsertSectionItem = { text: string; severity?: string; detail?: string };

export type DrugPackageInsertResponse = {
  drug: {
    id: string;
    yj_code: string;
    drug_name: string;
    drug_name_kana: string | null;
    generic_name: string | null;
    drug_price: unknown;
    unit: string | null;
    dosage_form: string | null;
    therapeutic_category: string | null;
    manufacturer: string | null;
    is_generic: boolean;
    is_narcotic: boolean;
    is_psychotropic: boolean;
    max_administration_days: number | null;
    transitional_expiry_date: string | null;
  };
  package_insert: {
    id: string;
    document_version: string | null;
    revised_at: string | null;
    source_format: string | null;
    sections: {
      contraindications: DrugPackageInsertSectionItem[];
      interactions: DrugPackageInsertSectionItem[];
      adverse_effects: DrugPackageInsertSectionItem[];
      dosage_adjustment_renal: DrugPackageInsertSectionItem[];
      precautions_elderly: DrugPackageInsertSectionItem[];
    };
  } | null;
  version_history: Array<{
    id: string;
    document_version: string | null;
    revised_at: string | null;
    source_format: string | null;
  }>;
  interactions: Array<{
    id: string;
    counterpart: {
      id: string;
      drug_name: string;
      yj_code: string;
    };
    severity: string;
    mechanism: string | null;
    clinical_effect: string | null;
    source: string;
  }>;
  applicable_alert_rules: Array<{
    id: string;
    alert_type: string;
    severity: string;
    message: string;
  }>;
};

type DrugPackageInsertSections = NonNullable<
  DrugPackageInsertResponse['package_insert']
>['sections'];

async function authenticatedGET(req: NextRequest, params: Promise<{ id: string }>) {
  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('医薬品IDが不正です');

  return runWithRequestAuthContext(ctx, async () =>
    withOrgContext(
      ctx.orgId,
      async (tx) => {
        const drug = await tx.drugMaster.findUnique({
          where: { id },
          select: {
            id: true,
            yj_code: true,
            drug_name: true,
            drug_name_kana: true,
            generic_name: true,
            drug_price: true,
            unit: true,
            dosage_form: true,
            therapeutic_category: true,
            manufacturer: true,
            is_generic: true,
            is_narcotic: true,
            is_psychotropic: true,
            max_administration_days: true,
            transitional_expiry_date: true,
          },
        });

        if (!drug) return notFound('医薬品が見つかりません');

        // Fetch all package insert versions (not just latest)
        const packageInserts = await tx.drugPackageInsert.findMany({
          where: { drug_master_id: id },
          orderBy: { revised_at: 'desc' },
          select: {
            id: true,
            contraindications: true,
            interactions: true,
            adverse_effects: true,
            dosage_adjustment_renal: true,
            precautions_elderly: true,
            document_version: true,
            revised_at: true,
            source_format: true,
            created_at: true,
          },
        });

        // Fetch interactions with this drug
        const [interactionsAsA, interactionsAsB] = await Promise.all([
          tx.drugInteraction.findMany({
            where: { drug_a_id: id },
            include: { drug_b: { select: { id: true, drug_name: true, yj_code: true } } },
            orderBy: { severity: 'asc' },
          }),
          tx.drugInteraction.findMany({
            where: { drug_b_id: id },
            include: { drug_a: { select: { id: true, drug_name: true, yj_code: true } } },
            orderBy: { severity: 'asc' },
          }),
        ]);

        // Merge interactions into unified list
        const interactions = [
          ...interactionsAsA.map((ix) => ({
            id: ix.id,
            counterpart: ix.drug_b,
            severity: ix.severity,
            mechanism: ix.mechanism,
            clinical_effect: ix.clinical_effect,
            source: ix.source,
          })),
          ...interactionsAsB.map((ix) => ({
            id: ix.id,
            counterpart: ix.drug_a,
            severity: ix.severity,
            mechanism: ix.mechanism,
            clinical_effect: ix.clinical_effect,
            source: ix.source,
          })),
        ];

        // Fetch applicable alert rules
        const alertRules = await tx.drugAlertRule.findMany({
          where: { is_active: true, OR: [{ org_id: ctx.orgId }, { org_id: null }] },
        });

        const applicableRules = alertRules
          .filter((rule) => isApplicableAlertRule(rule.condition, drug))
          .map((rule) => ({
            id: rule.id,
            alert_type: rule.alert_type,
            severity: rule.severity,
            message: rule.message,
          }));

        // Structure the latest package insert into readable sections
        const latest = packageInserts[0] ?? null;
        const latestPackageInsert = latest
          ? {
              id: latest.id,
              document_version: latest.document_version,
              revised_at: latest.revised_at?.toISOString() ?? null,
              source_format: latest.source_format,
              sections: {
                contraindications: formatSection(latest.contraindications),
                interactions: formatSection(latest.interactions),
                adverse_effects: formatSection(latest.adverse_effects),
                dosage_adjustment_renal: formatSection(latest.dosage_adjustment_renal),
                precautions_elderly: formatSection(latest.precautions_elderly),
              } satisfies DrugPackageInsertSections,
            }
          : null;

        return success({
          drug: {
            ...drug,
            transitional_expiry_date: drug.transitional_expiry_date?.toISOString() ?? null,
          },
          package_insert: latestPackageInsert,
          version_history: packageInserts.map((pi) => ({
            id: pi.id,
            document_version: pi.document_version,
            revised_at: pi.revised_at?.toISOString() ?? null,
            source_format: pi.source_format,
          })),
          interactions,
          applicable_alert_rules: applicableRules,
        } satisfies DrugPackageInsertResponse);
      },
      { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
    ),
  );
}

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req, routeContext.params));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('drug_masters_package_insert_get_unhandled_error', undefined, {
        event: 'drug_masters_package_insert_get_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}

/**
 * Convert raw JSON field into a displayable array of items.
 * Handles: array of objects with text, array of strings, or single object.
 */
type PackageInsertSectionItem = DrugPackageInsertSectionItem;

function readTrimmedString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readSectionTextObject(value: unknown): PackageInsertSectionItem | null {
  const obj = readJsonObject(value);
  if (!obj) return null;

  const text =
    readTrimmedString(obj.text) ??
    readTrimmedString(obj.name) ??
    readTrimmedString(obj.description) ??
    readTrimmedString(obj.summary) ??
    readTrimmedString(obj.recommendation);
  if (!text) return null;

  return {
    text,
    severity: readTrimmedString(obj.severity) ?? undefined,
    detail: readTrimmedString(obj.detail) ?? readTrimmedString(obj.recommendation) ?? undefined,
  };
}

function readSectionArrayValue(key: string, value: unknown): PackageInsertSectionItem | null {
  if (!Array.isArray(value)) return null;

  const texts = value
    .map((item) => readSectionItem(item)?.text)
    .filter((item): item is string => Boolean(item));
  if (texts.length === 0) return null;

  return { text: `${key}: ${texts.join(' / ')}` };
}

function readSectionObjectEntries(value: unknown): PackageInsertSectionItem[] {
  const object = readJsonObject(value);
  if (!object) return [];

  const direct = readSectionTextObject(object);
  if (direct) return [direct];

  return Object.entries(object).flatMap(([key, val]) => {
    const text = readTrimmedString(val);
    if (text) return [{ text: `${key}: ${text}` }];

    const arrayValue = readSectionArrayValue(key, val);
    return arrayValue ? [arrayValue] : [];
  });
}

function readSectionItem(value: unknown): PackageInsertSectionItem | null {
  const text = readTrimmedString(value);
  if (text) return { text };

  return readSectionTextObject(value);
}

function formatSection(value: unknown): Array<PackageInsertSectionItem> {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map(readSectionItem)
      .filter((item): item is PackageInsertSectionItem => item !== null);
  }

  const item = readSectionItem(value);
  return item ? [item] : readSectionObjectEntries(value);
}

function readStringArrayField(value: unknown, key: string): string[] {
  const field = readJsonObject(value)?.[key];
  return Array.isArray(field)
    ? field.filter((item): item is string => typeof item === 'string')
    : [];
}

function isApplicableAlertRule(
  condition: unknown,
  drug: { yj_code: string; therapeutic_category: string | null },
) {
  const yjCodes = readStringArrayField(condition, 'yj_codes');
  if (yjCodes.includes(drug.yj_code)) return true;

  if (!drug.therapeutic_category) return false;
  return readStringArrayField(condition, 'therapeutic_categories').includes(
    drug.therapeutic_category,
  );
}
