import { Client } from 'pg';

export type MigrationPreconditionIssue = {
  name: string;
  severity: 'error' | 'warn';
  detail: string;
};

export type MigrationPreconditionClient = {
  query<T extends object>(sql: string): Promise<{ rows: T[] }>;
};

type CountRow = { value: number };

async function queryCount(client: MigrationPreconditionClient, sql: string) {
  const result = await client.query<CountRow>(sql);
  return result.rows[0]?.value ?? 0;
}

export async function verifyMigrationPreconditions(client: MigrationPreconditionClient) {
  const issues: MigrationPreconditionIssue[] = [];

  const patientInsuranceOverlapGroups = await queryCount(
    client,
    `
      WITH overlapping_groups AS (
        SELECT
          a.org_id,
          a.patient_id,
          a.insurance_type,
          COALESCE(a.public_program_code, '') AS public_program_code
        FROM "PatientInsurance" AS a
        JOIN "PatientInsurance" AS b
          ON a.id < b.id
         AND a.org_id = b.org_id
         AND a.patient_id = b.patient_id
         AND a.insurance_type = b.insurance_type
         AND COALESCE(a.public_program_code, '') = COALESCE(b.public_program_code, '')
         AND a.is_active IS TRUE
         AND b.is_active IS TRUE
         AND daterange(
           COALESCE(a.valid_from, '-infinity'::date),
           COALESCE(a.valid_until, 'infinity'::date),
           '[]'
         ) && daterange(
           COALESCE(b.valid_from, '-infinity'::date),
           COALESCE(b.valid_until, 'infinity'::date),
           '[]'
         )
        GROUP BY a.org_id, a.patient_id, a.insurance_type, COALESCE(a.public_program_code, '')
      )
      SELECT COUNT(*)::int AS value FROM overlapping_groups
    `,
  );
  if (patientInsuranceOverlapGroups > 0) {
    issues.push({
      name: 'patient-insurance-active-overlap',
      severity: 'error',
      detail: `${patientInsuranceOverlapGroups} PatientInsurance active validity overlap group(s) must be resolved before adding PatientInsurance_active_validity_no_overlap`,
    });
  }

  const pcaDuplicateOpenRentalGroups = await queryCount(
    client,
    `
      SELECT COUNT(*)::int AS value
      FROM (
        SELECT org_id, pump_id
        FROM "PcaPumpRental"
        WHERE status IN ('scheduled', 'active', 'overdue')
        GROUP BY org_id, pump_id
        HAVING COUNT(*) > 1
      ) AS duplicate_open_rentals
    `,
  );
  if (pcaDuplicateOpenRentalGroups > 0) {
    issues.push({
      name: 'pca-duplicate-open-rentals',
      severity: 'error',
      detail: `${pcaDuplicateOpenRentalGroups} PCA pump(s) have multiple scheduled/active/overdue rentals and must be reconciled before PcaPumpRental_one_open_per_pump_idx`,
    });
  }

  const pcaCrossOrgPumpRentals = await queryCount(
    client,
    `
      SELECT COUNT(*)::int AS value
      FROM "PcaPumpRental" AS rental
      JOIN "PcaPump" AS pump ON pump.id = rental.pump_id
      WHERE pump.org_id <> rental.org_id
    `,
  );
  if (pcaCrossOrgPumpRentals > 0) {
    issues.push({
      name: 'pca-cross-org-pump-rentals',
      severity: 'error',
      detail: `${pcaCrossOrgPumpRentals} PCA rental row(s) reference a pump from another organization`,
    });
  }

  const pcaCrossOrgInstitutionRentals = await queryCount(
    client,
    `
      SELECT COUNT(*)::int AS value
      FROM "PcaPumpRental" AS rental
      JOIN "PrescriberInstitution" AS institution ON institution.id = rental.institution_id
      WHERE institution.org_id <> rental.org_id
    `,
  );
  if (pcaCrossOrgInstitutionRentals > 0) {
    issues.push({
      name: 'pca-cross-org-institution-rentals',
      severity: 'error',
      detail: `${pcaCrossOrgInstitutionRentals} PCA rental row(s) reference an institution from another organization`,
    });
  }

  const pcaInvalidDateRows = await queryCount(
    client,
    `
      SELECT COUNT(*)::int AS value
      FROM "PcaPumpRental"
      WHERE ("due_at" IS NOT NULL AND "due_at" < "rented_at")
         OR ("returned_at" IS NOT NULL AND "returned_at" < "rented_at")
    `,
  );
  if (pcaInvalidDateRows > 0) {
    issues.push({
      name: 'pca-invalid-rental-dates',
      severity: 'error',
      detail: `${pcaInvalidDateRows} PCA rental row(s) have due_at/returned_at before rented_at`,
    });
  }

  const pcaInvalidReturnedStateRows = await queryCount(
    client,
    `
      SELECT COUNT(*)::int AS value
      FROM "PcaPumpRental"
      WHERE ("status" = 'returned' AND "returned_at" IS NULL)
         OR ("status" <> 'returned' AND "returned_at" IS NOT NULL)
    `,
  );
  if (pcaInvalidReturnedStateRows > 0) {
    issues.push({
      name: 'pca-invalid-returned-state',
      severity: 'error',
      detail: `${pcaInvalidReturnedStateRows} PCA rental row(s) have inconsistent status/returned_at values`,
    });
  }

  const pcaDuplicateSerialGroups = await queryCount(
    client,
    `
      SELECT COUNT(*)::int AS value
      FROM (
        SELECT org_id, serial_number
        FROM "PcaPump"
        WHERE "serial_number" IS NOT NULL
          AND btrim("serial_number") <> ''
        GROUP BY org_id, serial_number
        HAVING COUNT(*) > 1
      ) AS duplicate_serials
    `,
  );
  if (pcaDuplicateSerialGroups > 0) {
    issues.push({
      name: 'pca-duplicate-serial-numbers',
      severity: 'error',
      detail: `${pcaDuplicateSerialGroups} PCA pump serial number group(s) are duplicated within an organization`,
    });
  }

  const btreeGistInstalled = await queryCount(
    client,
    "SELECT COUNT(*)::int AS value FROM pg_extension WHERE extname = 'btree_gist'",
  );
  if (btreeGistInstalled === 0) {
    issues.push({
      name: 'btree-gist-extension',
      severity: 'warn',
      detail:
        'btree_gist is not installed. The migration role must be allowed to CREATE EXTENSION, or the extension must be installed before deploying PatientInsurance overlap exclusion.',
    });
  }

  return {
    ok: issues.every((issue) => issue.severity !== 'error'),
    issues,
    checked: [
      'patient-insurance-active-overlap',
      'pca-duplicate-open-rentals',
      'pca-cross-org-pump-rentals',
      'pca-cross-org-institution-rentals',
      'pca-invalid-rental-dates',
      'pca-invalid-returned-state',
      'pca-duplicate-serial-numbers',
      'btree-gist-extension',
    ],
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await verifyMigrationPreconditions(client);
    console.log(JSON.stringify(result));
    if (!result.ok) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
