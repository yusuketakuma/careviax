-- AUTHZ-ACCOUNT-MODEL-V1-001A static data-inventory query.
--
-- This query is not approval to inspect production data. Non-disposable execution
-- requires the separate LIVE-IDENTITY-DRIFT human gate, privacy review, and an
-- EXPLAIN/cost review. Output is category-level only; exact small cells are
-- suppressed and no user, tenant, site, credential, or token identifier is returned.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';

WITH
legacy_role_capabilities(
  role,
  can_dispense,
  can_audit_dispense,
  can_set,
  can_audit_set
) AS (
  VALUES
    ('owner', true, true, true, true),
    ('admin', true, true, true, true),
    ('pharmacist', true, true, true, true),
    ('pharmacist_trainee', true, false, true, false),
    ('clerk', false, false, false, false),
    ('driver', false, false, false, false),
    ('external_viewer', false, false, false, false)
),
membership_groups AS (
  SELECT
    "user_id",
    "org_id",
    COUNT(DISTINCT "role") AS role_count,
    COUNT(*) FILTER (WHERE "site_id" IS NULL) AS null_site_count,
    COUNT(DISTINCT "site_id") FILTER (WHERE "site_id" IS NOT NULL) AS site_count
  FROM "Membership"
  WHERE "is_active" = true
  GROUP BY "user_id", "org_id"
),
raw_metrics(metric, category, count_value) AS (
  SELECT
    'tenant_role_distribution',
    "role"::text,
    COUNT(*)::bigint
  FROM "Membership"
  WHERE "is_active" = true
  GROUP BY "role"

  UNION ALL

  SELECT
    'platform_role_distribution',
    "role"::text,
    COUNT(*)::bigint
  FROM "PlatformOperator"
  GROUP BY "role"

  UNION ALL

  SELECT
    'membership_anomaly',
    'mixed_active_roles',
    COUNT(*)::bigint
  FROM membership_groups
  WHERE role_count > 1

  UNION ALL

  SELECT
    'membership_anomaly',
    'duplicate_null_site_rows',
    COUNT(*)::bigint
  FROM membership_groups
  WHERE null_site_count > 1

  UNION ALL

  SELECT
    'membership_anomaly',
    'multiple_active_sites',
    COUNT(*)::bigint
  FROM membership_groups
  WHERE site_count > 1

  UNION ALL

  SELECT
    'membership_anomaly',
    'role_flag_mismatch',
    COUNT(*)::bigint
  FROM "Membership" membership
  LEFT JOIN legacy_role_capabilities expected ON expected.role = membership."role"::text
  WHERE membership."is_active" = true
    AND (
      expected.role IS NULL
      OR membership."can_dispense" IS DISTINCT FROM expected.can_dispense
      OR membership."can_audit_dispense" IS DISTINCT FROM expected.can_audit_dispense
      OR membership."can_set" IS DISTINCT FROM expected.can_set
      OR membership."can_audit_set" IS DISTINCT FROM expected.can_audit_set
    )

  UNION ALL

  SELECT
    'identity_orphan',
    'membership_missing_user',
    COUNT(*)::bigint
  FROM "Membership" membership
  LEFT JOIN "User" app_user ON app_user."id" = membership."user_id"
  WHERE app_user."id" IS NULL

  UNION ALL

  SELECT
    'identity_orphan',
    'membership_user_org_mismatch',
    COUNT(*)::bigint
  FROM "Membership" membership
  JOIN "User" app_user ON app_user."id" = membership."user_id"
  WHERE app_user."org_id" <> membership."org_id"

  UNION ALL

  SELECT
    'identity_orphan',
    'active_user_without_active_membership',
    COUNT(*)::bigint
  FROM "User" app_user
  LEFT JOIN "Membership" membership
    ON membership."user_id" = app_user."id"
    AND membership."org_id" = app_user."org_id"
    AND membership."is_active" = true
  WHERE app_user."is_active" = true
    AND membership."id" IS NULL

  UNION ALL

  SELECT
    'identity_orphan',
    'platform_operator_missing_user',
    COUNT(*)::bigint
  FROM "PlatformOperator" operator
  LEFT JOIN "User" app_user ON app_user."id" = operator."user_id"
  WHERE app_user."id" IS NULL

  UNION ALL

  SELECT
    'identity_orphan',
    'credential_missing_user',
    COUNT(*)::bigint
  FROM "PharmacistCredential" credential
  LEFT JOIN "User" app_user ON app_user."id" = credential."user_id"
  WHERE app_user."id" IS NULL

  UNION ALL

  SELECT
    'legacy_credential_completeness',
    CASE
      WHEN NULLIF(BTRIM("certification_type"), '') IS NULL THEN 'missing_type'
      WHEN NULLIF(BTRIM("certification_number"), '') IS NULL THEN 'missing_number'
      WHEN "issued_date" IS NULL THEN 'missing_issued_date'
      WHEN "expiry_date" IS NULL THEN 'missing_expiry_date'
      ELSE 'all_legacy_fields_present_noncanonical'
    END,
    COUNT(*)::bigint
  FROM "PharmacistCredential"
  GROUP BY 2
),
safe_metrics AS (
  SELECT
    metric,
    category,
    CASE WHEN count_value = 0 OR count_value >= 5 THEN count_value ELSE NULL END AS observed_count,
    CASE
      WHEN count_value = 0 THEN '0'
      WHEN count_value < 5 THEN '1-4'
      WHEN count_value < 10 THEN '5-9'
      ELSE '10+'
    END AS count_band
  FROM raw_metrics
)
SELECT metric, category, observed_count, count_band
FROM safe_metrics
ORDER BY metric, category;

COMMIT;
