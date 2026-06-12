import { inspect } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

const USAGE = [
  'Usage: pnpm db:verify-migration-preconditions [--help]',
  'Read-only precheck for approved DB migration targets.',
].join('\n');

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

  const duplicateFileAssetStorageKeys = await queryCount(
    client,
    `
      SELECT COUNT(*)::int AS value
      FROM (
        SELECT value->>'storageKey' AS storage_key
        FROM "Setting"
        WHERE "scope" = 'organization'
          AND "key" LIKE 'file_asset:%'
          AND jsonb_typeof("value") = 'object'
          AND value->>'version' = '1'
          AND value->>'id' IS NOT NULL
          AND value->>'storageKey' IS NOT NULL
        GROUP BY value->>'storageKey'
        HAVING COUNT(DISTINCT value->>'id') > 1
      ) AS duplicate_storage_keys
    `,
  );
  if (duplicateFileAssetStorageKeys > 0) {
    issues.push({
      name: 'file-asset-duplicate-storage-key',
      severity: 'error',
      detail: `${duplicateFileAssetStorageKeys} file asset storageKey group(s) map to multiple ids and would violate FileAsset_storage_key_key`,
    });
  }

  const invalidFileAssetSizeBytes = await queryCount(
    client,
    `
      SELECT COUNT(*)::int AS value
      FROM "Setting"
      WHERE "scope" = 'organization'
        AND "key" LIKE 'file_asset:%'
        AND jsonb_typeof("value") = 'object'
        AND value->>'version' = '1'
        AND NULLIF(value->>'sizeBytes', '') IS NOT NULL
        AND NOT (value->>'sizeBytes' ~ '^[0-9]+$')
    `,
  );
  if (invalidFileAssetSizeBytes > 0) {
    issues.push({
      name: 'file-asset-invalid-size-bytes',
      severity: 'error',
      detail: `${invalidFileAssetSizeBytes} file asset Setting row(s) have non-integer sizeBytes and would fail FileAsset backfill casting`,
    });
  }

  const outOfRangeFileAssetSizeBytes = await queryCount(
    client,
    `
      SELECT COUNT(*)::int AS value
      FROM "Setting"
      WHERE "scope" = 'organization'
        AND "key" LIKE 'file_asset:%'
        AND jsonb_typeof("value") = 'object'
        AND value->>'version' = '1'
        AND value->>'sizeBytes' ~ '^[0-9]+$'
        AND (value->>'sizeBytes')::numeric > 2147483647
    `,
  );
  if (outOfRangeFileAssetSizeBytes > 0) {
    issues.push({
      name: 'file-asset-size-bytes-out-of-range',
      severity: 'error',
      detail: `${outOfRangeFileAssetSizeBytes} file asset Setting row(s) have sizeBytes values outside PostgreSQL integer range`,
    });
  }

  const invalidFileAssetTimestamps = await queryCount(
    client,
    `
      SELECT COUNT(*)::int AS value
      FROM "Setting" AS setting
      CROSS JOIN LATERAL (
        VALUES
          ('createdAt', setting.value->>'createdAt'),
          ('updatedAt', setting.value->>'updatedAt'),
          ('completedAt', setting.value->>'completedAt'),
          ('expiresAt', setting.value->>'expiresAt')
      ) AS timestamp_field(field_name, raw_value)
      WHERE setting."scope" = 'organization'
        AND setting."key" LIKE 'file_asset:%'
        AND jsonb_typeof(setting."value") = 'object'
        AND setting.value->>'version' = '1'
        AND NULLIF(timestamp_field.raw_value, '') IS NOT NULL
        AND NOT pg_input_is_valid(timestamp_field.raw_value, 'timestamp')
    `,
  );
  if (invalidFileAssetTimestamps > 0) {
    issues.push({
      name: 'file-asset-invalid-timestamps',
      severity: 'error',
      detail: `${invalidFileAssetTimestamps} file asset timestamp value(s) would fail FileAsset backfill casting`,
    });
  }

  const missingFileAssetOrganizations = await queryCount(
    client,
    `
      SELECT COUNT(*)::int AS value
      FROM "Setting" AS setting
      LEFT JOIN "Organization" AS org ON org.id = setting.value->>'orgId'
      WHERE setting."scope" = 'organization'
        AND setting."key" LIKE 'file_asset:%'
        AND jsonb_typeof(setting."value") = 'object'
        AND setting.value->>'version' = '1'
        AND setting.value->>'orgId' IS NOT NULL
        AND org.id IS NULL
    `,
  );
  if (missingFileAssetOrganizations > 0) {
    issues.push({
      name: 'file-asset-missing-organization',
      severity: 'error',
      detail: `${missingFileAssetOrganizations} file asset Setting row(s) reference a missing organization and would violate FileAsset_org_id_fkey`,
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
      'file-asset-duplicate-storage-key',
      'file-asset-invalid-size-bytes',
      'file-asset-size-bytes-out-of-range',
      'file-asset-invalid-timestamps',
      'file-asset-missing-organization',
    ],
  };
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(USAGE);
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const client = new Client({
    connectionString: databaseUrl,
    statement_timeout: 120_000,
    query_timeout: 120_000,
  });
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        message:
          error instanceof Error && error.message.length > 0
            ? error.message
            : inspect(error, { depth: 2 }),
      }),
    );
    process.exit(1);
  });
}
