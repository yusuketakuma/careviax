import { z } from 'zod';

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const nullableTimestamp = z.string().datetime({ offset: true }).nullable();

const consentedPatientSchema = z
  .object({
    id: nonEmptyText(200),
    name: nonEmptyText(500),
  })
  .strip();

const pharmacistCredentialSchema = z
  .object({
    id: nonEmptyText(200),
    user_id: nonEmptyText(200),
    user_name: nonEmptyText(500),
    certification_type: nonEmptyText(500),
    certification_number: z.string().max(500).nullable(),
    issued_date: nullableTimestamp,
    expiry_date: nullableTimestamp,
    tenure_years: z.number().finite().min(0).max(80).nullable(),
    weekly_work_hours: z.number().finite().min(0).max(168).nullable(),
    consented_patients: z.array(consentedPatientSchema).max(500),
  })
  .strip()
  .superRefine((credential, context) => {
    if (
      credential.issued_date !== null &&
      credential.expiry_date !== null &&
      credential.issued_date > credential.expiry_date
    ) {
      context.addIssue({
        code: 'custom',
        path: ['expiry_date'],
        message: 'Credential expiry must not precede its issue date',
      });
    }

    const patientIds = new Set<string>();
    for (const [index, patient] of credential.consented_patients.entries()) {
      if (patientIds.has(patient.id)) {
        context.addIssue({
          code: 'custom',
          path: ['consented_patients', index, 'id'],
          message: 'Duplicate consented patient identity',
        });
      }
      patientIds.add(patient.id);
    }
  });

export const pharmacistCredentialListResponseSchema = z
  .object({
    data: z.array(pharmacistCredentialSchema),
    meta: z
      .object({
        total_count: z.number().finite().int().nonnegative(),
        visible_count: z.number().finite().int().nonnegative(),
        hidden_count: z.number().finite().int().nonnegative(),
        truncated: z.boolean(),
        count_basis: z.literal('pharmacist_credentials'),
        filters_applied: z.object({}).strict(),
        limit: z.number().finite().int().min(1).max(200),
      })
      .strict(),
  })
  .strict()
  .superRefine(({ data, meta }, context) => {
    if (
      meta.visible_count !== data.length ||
      meta.total_count !== meta.visible_count + meta.hidden_count ||
      meta.truncated !== meta.hidden_count > 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['meta'],
        message: 'Credential list metadata does not match returned data',
      });
    }

    const credentialIds = new Set<string>();
    for (const [index, credential] of data.entries()) {
      if (credentialIds.has(credential.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate pharmacist credential identity',
        });
      }
      credentialIds.add(credential.id);
    }
  });

export type PharmacistCredential = z.infer<typeof pharmacistCredentialSchema>;
export type PharmacistCredentialListResponse = z.infer<
  typeof pharmacistCredentialListResponseSchema
>;
