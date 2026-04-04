import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { success, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

/**
 * GET /api/drug-masters/:id/package-insert
 *
 * Returns the latest package insert for a drug, with all sections
 * structured for display. Also returns drug interactions and alert rules.
 */
export const GET = withAuthContext(
  async (
    _req: NextRequest,
    _ctx,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await params;

    const drug = await prisma.drugMaster.findUnique({
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
    const packageInserts = await prisma.drugPackageInsert.findMany({
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
      prisma.drugInteraction.findMany({
        where: { drug_a_id: id },
        include: { drug_b: { select: { id: true, drug_name: true, yj_code: true } } },
        orderBy: { severity: 'asc' },
      }),
      prisma.drugInteraction.findMany({
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
    const alertRules = await prisma.drugAlertRule.findMany({
      where: { is_active: true },
    });

    const applicableRules = alertRules.filter((rule) => {
      const condition = rule.condition as { yj_codes?: string[]; therapeutic_categories?: string[] } | null;
      if (!condition) return false;
      return (
        (condition.yj_codes?.includes(drug.yj_code) ?? false) ||
        (drug.therapeutic_category && (condition.therapeutic_categories?.includes(drug.therapeutic_category) ?? false))
      );
    }).map((rule) => ({
      id: rule.id,
      alert_type: rule.alert_type,
      severity: rule.severity,
      message: rule.message,
    }));

    // Structure the latest package insert into readable sections
    const latest = packageInserts[0] ?? null;
    const sections = latest ? {
      contraindications: formatSection(latest.contraindications),
      interactions: formatSection(latest.interactions),
      adverse_effects: formatSection(latest.adverse_effects),
      dosage_adjustment_renal: formatSection(latest.dosage_adjustment_renal),
      precautions_elderly: formatSection(latest.precautions_elderly),
    } : null;

    return success({
      drug,
      package_insert: latest ? {
        id: latest.id,
        document_version: latest.document_version,
        revised_at: latest.revised_at,
        source_format: latest.source_format,
        sections,
      } : null,
      version_history: packageInserts.map((pi) => ({
        id: pi.id,
        document_version: pi.document_version,
        revised_at: pi.revised_at,
        source_format: pi.source_format,
      })),
      interactions,
      applicable_alert_rules: applicableRules,
    });
  }
);

/**
 * Convert raw JSON field into a displayable array of items.
 * Handles: array of objects with text, array of strings, or single object.
 */
function formatSection(value: unknown): Array<{ text: string; severity?: string; detail?: string }> {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return { text: item };
        if (typeof item === 'object' && item !== null) {
          const obj = item as Record<string, unknown>;
          return {
            text: String(obj.text ?? obj.name ?? obj.description ?? JSON.stringify(obj)),
            severity: obj.severity ? String(obj.severity) : undefined,
            detail: obj.detail ? String(obj.detail) : obj.recommendation ? String(obj.recommendation) : undefined,
          };
        }
        return { text: String(item) };
      })
      .filter((item) => item.text.length > 0);
  }

  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, unknown>).map(([key, val]) => ({
      text: `${key}: ${typeof val === 'string' ? val : JSON.stringify(val)}`,
    }));
  }

  return [{ text: String(value) }];
}
