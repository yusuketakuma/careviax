import { z } from 'zod';

/**
 * Client-view response contracts for pharmacy-cooperation dashboards.
 * These schemas intentionally keep the stable fields consumed by screens and
 * strip route-only bookkeeping fields from broader API responses.
 */
export const pharmacyCooperationNamedEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const pharmacySiteRowSchema = pharmacyCooperationNamedEntitySchema.extend({
  address: z.string().nullable().optional(),
});

export const partnerPharmacySummarySchema = pharmacyCooperationNamedEntitySchema.extend({
  status: z.string(),
});

export const partnerPharmacyRowSchema = partnerPharmacySummarySchema.extend({
  pharmacy_code: z.string().nullable(),
  tel: z.string().nullable(),
  updated_at: z.string().optional(),
});

export const pharmacyPartnershipRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  base_site_id: z.string(),
  partner_pharmacy_id: z.string(),
  effective_from: z.string().nullable(),
  effective_to: z.string().nullable(),
  base_site: pharmacyCooperationNamedEntitySchema,
  partner_pharmacy: partnerPharmacySummarySchema,
});

const pharmacyContractActiveFeeRuleSchema = z.object({
  billing_model: z.string(),
  unit_price: z.number().nullable(),
  tax_category: z.string(),
});

const pharmacyContractLatestVersionSchema = z
  .object({
    version_no: z.number(),
    status: z.string(),
    active_fee_rule: pharmacyContractActiveFeeRuleSchema.nullable(),
  })
  .nullable();

export const pharmacyContractRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
  partnership: z.object({
    id: z.string(),
    status: z.string(),
    base_site: pharmacyCooperationNamedEntitySchema,
    partner_pharmacy: partnerPharmacySummarySchema,
  }),
  latest_version: pharmacyContractLatestVersionSchema,
});

export type PharmacySiteRowContract = z.infer<typeof pharmacySiteRowSchema>;
export type PartnerPharmacyRowContract = z.infer<typeof partnerPharmacyRowSchema>;
export type PharmacyPartnershipRowContract = z.infer<typeof pharmacyPartnershipRowSchema>;
export type PharmacyContractRowContract = z.infer<typeof pharmacyContractRowSchema>;

type PharmacyPartnershipRowContractInput = Omit<
  PharmacyPartnershipRowContract,
  'effective_from' | 'effective_to'
> & {
  effective_from: string | Date | null;
  effective_to: string | Date | null;
};

function serializeOptionalDate(value: string | Date | null) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function toPharmacyPartnershipRowContract(
  row: PharmacyPartnershipRowContractInput,
): PharmacyPartnershipRowContract {
  return pharmacyPartnershipRowSchema.parse({
    id: row.id,
    status: row.status,
    base_site_id: row.base_site_id,
    partner_pharmacy_id: row.partner_pharmacy_id,
    effective_from: serializeOptionalDate(row.effective_from),
    effective_to: serializeOptionalDate(row.effective_to),
    base_site: row.base_site,
    partner_pharmacy: row.partner_pharmacy,
  });
}
