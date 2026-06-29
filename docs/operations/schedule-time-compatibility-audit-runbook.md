# Schedule Time Compatibility Audit Runbook

Use this before releasing the UTC-safe schedule time writer to a shared or
production database. The pre-release path is SELECT-only; any UPDATE, migration,
`prisma db push`, direct table repair, or scripted backfill requires explicit
human approval for the target database, exact SQL/script, max rows, batch size,
and rollback plan.

## Scope

Audit only these schedule time fields:

- `VisitSchedule`: `time_window_start`, `time_window_end`,
  `time_constraint_start`, `time_constraint_end`
- `VisitScheduleProposal`: `time_window_start`, `time_window_end`
- `PharmacistShift`: `available_from`, `available_to`
- `PharmacistShiftTemplate`: `available_from`, `available_to`
- `BusinessHoliday`: `open_time`, `close_time`
- `PharmacyOperatingHours`: `open_time`, `close_time`
- `Facility`: `acceptance_time_from`, `acceptance_time_to`
- `PatientSchedulePreference`: `preferred_time_from`, `preferred_time_to`,
  `phone_contact_from`, `phone_contact_to`, `facility_time_from`,
  `facility_time_to`

Do not export PHI, patient names, addresses, phone numbers, notes, free text, raw
row IDs, raw `org_id`, or secrets. Shared evidence should be aggregate counts
plus table/column names. If organization grouping is needed, publish only a
local report alias such as `org_scope_1`; keep the raw ID mapping in the
approved operator ticket, not in chat, logs, PR comments, or release notes.

## SELECT-Only Audit

Use a read-only DB role when available. Do not paste a database URL into a
command, shell history, PR, or chat. Either use a pre-provisioned readonly
service entry, or export a readonly URL from a secret manager into a local
environment variable for this shell only:

```bash
# Preferred when pg_service.conf is managed by ops:
PGSERVICE=phos-schedule-time-readonly \
psql --set=ON_ERROR_STOP=1 --no-align --tuples-only

# Acceptable local-only fallback when a secret manager populates the variable:
test -n "${SCHEDULE_TIME_AUDIT_DATABASE_URL:-}" &&
psql "$SCHEDULE_TIME_AUDIT_DATABASE_URL" --set=ON_ERROR_STOP=1 --no-align --tuples-only
```

Before running any audit query, prove the session is read-only and keep this
aggregate-safe proof with the release evidence:

```sql
BEGIN READ ONLY;
SHOW transaction_read_only;
```

The expected value is `on`. If it is not `on`, stop and reconnect with a
read-only role or a transaction that is explicitly read-only. Keep the
transaction open for the SELECT-only checks below, then `ROLLBACK;` when done.

Verify the audit SQL still covers every scoped column before trusting the
results. This query must return one row with `coverage_status = PASS` and zero
missing/unexpected rows. Update this gate whenever the Scope list changes:

```sql
WITH expected_scope(table_name, column_name) AS (
  VALUES
    ('VisitSchedule', 'time_window_start'),
    ('VisitSchedule', 'time_window_end'),
    ('VisitSchedule', 'time_constraint_start'),
    ('VisitSchedule', 'time_constraint_end'),
    ('VisitScheduleProposal', 'time_window_start'),
    ('VisitScheduleProposal', 'time_window_end'),
    ('PharmacistShift', 'available_from'),
    ('PharmacistShift', 'available_to'),
    ('PharmacistShiftTemplate', 'available_from'),
    ('PharmacistShiftTemplate', 'available_to'),
    ('BusinessHoliday', 'open_time'),
    ('BusinessHoliday', 'close_time'),
    ('PharmacyOperatingHours', 'open_time'),
    ('PharmacyOperatingHours', 'close_time'),
    ('Facility', 'acceptance_time_from'),
    ('Facility', 'acceptance_time_to'),
    ('PatientSchedulePreference', 'preferred_time_from'),
    ('PatientSchedulePreference', 'preferred_time_to'),
    ('PatientSchedulePreference', 'phone_contact_from'),
    ('PatientSchedulePreference', 'phone_contact_to'),
    ('PatientSchedulePreference', 'facility_time_from'),
    ('PatientSchedulePreference', 'facility_time_to')
),
audited_scope(table_name, column_name) AS (
  VALUES
    ('VisitSchedule', 'time_window_start'),
    ('VisitSchedule', 'time_window_end'),
    ('VisitSchedule', 'time_constraint_start'),
    ('VisitSchedule', 'time_constraint_end'),
    ('VisitScheduleProposal', 'time_window_start'),
    ('VisitScheduleProposal', 'time_window_end'),
    ('PharmacistShift', 'available_from'),
    ('PharmacistShift', 'available_to'),
    ('PharmacistShiftTemplate', 'available_from'),
    ('PharmacistShiftTemplate', 'available_to'),
    ('BusinessHoliday', 'open_time'),
    ('BusinessHoliday', 'close_time'),
    ('PharmacyOperatingHours', 'open_time'),
    ('PharmacyOperatingHours', 'close_time'),
    ('Facility', 'acceptance_time_from'),
    ('Facility', 'acceptance_time_to'),
    ('PatientSchedulePreference', 'preferred_time_from'),
    ('PatientSchedulePreference', 'preferred_time_to'),
    ('PatientSchedulePreference', 'phone_contact_from'),
    ('PatientSchedulePreference', 'phone_contact_to'),
    ('PatientSchedulePreference', 'facility_time_from'),
    ('PatientSchedulePreference', 'facility_time_to')
),
missing AS (
  SELECT * FROM expected_scope
  EXCEPT
  SELECT * FROM audited_scope
),
unexpected AS (
  SELECT * FROM audited_scope
  EXCEPT
  SELECT * FROM expected_scope
)
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM missing)
              AND NOT EXISTS (SELECT 1 FROM unexpected)
            THEN 'PASS'
            ELSE 'FAIL'
       END AS coverage_status,
       (SELECT count(*) FROM missing) AS missing_scope_rows,
       (SELECT count(*) FROM unexpected) AS unexpected_scope_rows;
```

Run aggregate shape checks first. This unpivots every scoped `@db.Time`
column so end/to/close-side drift is visible too:

```sql
WITH time_values AS (
  SELECT 'VisitSchedule' AS table_name, 'time_window_start' AS column_name, org_id, created_at, time_window_start AS value FROM "VisitSchedule" WHERE time_window_start IS NOT NULL
  UNION ALL SELECT 'VisitSchedule', 'time_window_end', org_id, created_at, time_window_end FROM "VisitSchedule" WHERE time_window_end IS NOT NULL
  UNION ALL SELECT 'VisitSchedule', 'time_constraint_start', org_id, created_at, time_constraint_start FROM "VisitSchedule" WHERE time_constraint_start IS NOT NULL
  UNION ALL SELECT 'VisitSchedule', 'time_constraint_end', org_id, created_at, time_constraint_end FROM "VisitSchedule" WHERE time_constraint_end IS NOT NULL
  UNION ALL SELECT 'VisitScheduleProposal', 'time_window_start', org_id, created_at, time_window_start FROM "VisitScheduleProposal" WHERE time_window_start IS NOT NULL
  UNION ALL SELECT 'VisitScheduleProposal', 'time_window_end', org_id, created_at, time_window_end FROM "VisitScheduleProposal" WHERE time_window_end IS NOT NULL
  UNION ALL SELECT 'PharmacistShift', 'available_from', org_id, created_at, available_from FROM "PharmacistShift" WHERE available_from IS NOT NULL
  UNION ALL SELECT 'PharmacistShift', 'available_to', org_id, created_at, available_to FROM "PharmacistShift" WHERE available_to IS NOT NULL
  UNION ALL SELECT 'PharmacistShiftTemplate', 'available_from', org_id, created_at, available_from FROM "PharmacistShiftTemplate" WHERE available_from IS NOT NULL
  UNION ALL SELECT 'PharmacistShiftTemplate', 'available_to', org_id, created_at, available_to FROM "PharmacistShiftTemplate" WHERE available_to IS NOT NULL
  UNION ALL SELECT 'BusinessHoliday', 'open_time', org_id, created_at, open_time FROM "BusinessHoliday" WHERE open_time IS NOT NULL
  UNION ALL SELECT 'BusinessHoliday', 'close_time', org_id, created_at, close_time FROM "BusinessHoliday" WHERE close_time IS NOT NULL
  UNION ALL SELECT 'PharmacyOperatingHours', 'open_time', org_id, created_at, open_time FROM "PharmacyOperatingHours" WHERE open_time IS NOT NULL
  UNION ALL SELECT 'PharmacyOperatingHours', 'close_time', org_id, created_at, close_time FROM "PharmacyOperatingHours" WHERE close_time IS NOT NULL
  UNION ALL SELECT 'Facility', 'acceptance_time_from', org_id, created_at, acceptance_time_from FROM "Facility" WHERE acceptance_time_from IS NOT NULL
  UNION ALL SELECT 'Facility', 'acceptance_time_to', org_id, created_at, acceptance_time_to FROM "Facility" WHERE acceptance_time_to IS NOT NULL
  UNION ALL SELECT 'PatientSchedulePreference', 'preferred_time_from', org_id, created_at, preferred_time_from FROM "PatientSchedulePreference" WHERE preferred_time_from IS NOT NULL
  UNION ALL SELECT 'PatientSchedulePreference', 'preferred_time_to', org_id, created_at, preferred_time_to FROM "PatientSchedulePreference" WHERE preferred_time_to IS NOT NULL
  UNION ALL SELECT 'PatientSchedulePreference', 'phone_contact_from', org_id, created_at, phone_contact_from FROM "PatientSchedulePreference" WHERE phone_contact_from IS NOT NULL
  UNION ALL SELECT 'PatientSchedulePreference', 'phone_contact_to', org_id, created_at, phone_contact_to FROM "PatientSchedulePreference" WHERE phone_contact_to IS NOT NULL
  UNION ALL SELECT 'PatientSchedulePreference', 'facility_time_from', org_id, created_at, facility_time_from FROM "PatientSchedulePreference" WHERE facility_time_from IS NOT NULL
  UNION ALL SELECT 'PatientSchedulePreference', 'facility_time_to', org_id, created_at, facility_time_to FROM "PatientSchedulePreference" WHERE facility_time_to IS NOT NULL
)
SELECT table_name,
       column_name,
       count(*) AS rows_with_value,
       min(value)::text AS min_time,
       max(value)::text AS max_time,
       count(*) FILTER (WHERE value >= TIME '00:00' AND value < TIME '09:00') AS suspicious_early_rows
FROM time_values
GROUP BY table_name, column_name
ORDER BY table_name, column_name;
```

Then check likely legacy-JST writer rows. For daytime operational schedules,
stored `00:00`-`08:59` values are suspicious because the old JST-local `Date`
writer could persist a UTC-shifted clock value. Pair checks catch end/to/close
drift and impossible or implausible durations:

```sql
WITH pairs AS (
  SELECT 'VisitSchedule.time_window' AS pair_name, org_id, created_at, time_window_start AS starts_at, time_window_end AS ends_at FROM "VisitSchedule"
  UNION ALL SELECT 'VisitSchedule.time_constraint', org_id, created_at, time_constraint_start, time_constraint_end FROM "VisitSchedule"
  UNION ALL SELECT 'VisitScheduleProposal.time_window', org_id, created_at, time_window_start, time_window_end FROM "VisitScheduleProposal"
  UNION ALL SELECT 'PharmacistShift.available', org_id, created_at, available_from, available_to FROM "PharmacistShift"
  UNION ALL SELECT 'PharmacistShiftTemplate.available', org_id, created_at, available_from, available_to FROM "PharmacistShiftTemplate"
  UNION ALL SELECT 'BusinessHoliday.open', org_id, created_at, open_time, close_time FROM "BusinessHoliday"
  UNION ALL SELECT 'PharmacyOperatingHours.open', org_id, created_at, open_time, close_time FROM "PharmacyOperatingHours"
  UNION ALL SELECT 'Facility.acceptance', org_id, created_at, acceptance_time_from, acceptance_time_to FROM "Facility"
  UNION ALL SELECT 'PatientSchedulePreference.preferred', org_id, created_at, preferred_time_from, preferred_time_to FROM "PatientSchedulePreference"
  UNION ALL SELECT 'PatientSchedulePreference.phone_contact', org_id, created_at, phone_contact_from, phone_contact_to FROM "PatientSchedulePreference"
  UNION ALL SELECT 'PatientSchedulePreference.facility', org_id, created_at, facility_time_from, facility_time_to FROM "PatientSchedulePreference"
)
SELECT pair_name,
       count(*) FILTER (WHERE starts_at IS NOT NULL OR ends_at IS NOT NULL) AS rows_with_pair_data,
       count(*) FILTER (WHERE starts_at IS NULL AND ends_at IS NOT NULL) AS missing_start_rows,
       count(*) FILTER (WHERE starts_at IS NOT NULL AND ends_at IS NULL) AS missing_end_rows,
       count(*) FILTER (WHERE starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at <= starts_at) AS non_increasing_rows,
       count(*) FILTER (
         WHERE starts_at IS NOT NULL
           AND ends_at IS NOT NULL
           AND EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60 > 720
       ) AS duration_over_12h_rows
FROM pairs
GROUP BY pair_name
ORDER BY pair_name;
```

For mixed-state triage, group by organization alias and creation day only. Do
not output raw `org_id`; the `dense_rank()` alias is stable only within this
result set and is sufficient to identify mixed old/new writer states for release
review:

```sql
WITH time_values AS (
  SELECT 'VisitSchedule' AS table_name, 'time_window_start' AS column_name, org_id, created_at, time_window_start AS value FROM "VisitSchedule" WHERE time_window_start IS NOT NULL
  UNION ALL SELECT 'VisitSchedule', 'time_window_end', org_id, created_at, time_window_end FROM "VisitSchedule" WHERE time_window_end IS NOT NULL
  UNION ALL SELECT 'VisitSchedule', 'time_constraint_start', org_id, created_at, time_constraint_start FROM "VisitSchedule" WHERE time_constraint_start IS NOT NULL
  UNION ALL SELECT 'VisitSchedule', 'time_constraint_end', org_id, created_at, time_constraint_end FROM "VisitSchedule" WHERE time_constraint_end IS NOT NULL
  UNION ALL SELECT 'VisitScheduleProposal', 'time_window_start', org_id, created_at, time_window_start FROM "VisitScheduleProposal" WHERE time_window_start IS NOT NULL
  UNION ALL SELECT 'VisitScheduleProposal', 'time_window_end', org_id, created_at, time_window_end FROM "VisitScheduleProposal" WHERE time_window_end IS NOT NULL
  UNION ALL SELECT 'PharmacistShift', 'available_from', org_id, created_at, available_from FROM "PharmacistShift" WHERE available_from IS NOT NULL
  UNION ALL SELECT 'PharmacistShift', 'available_to', org_id, created_at, available_to FROM "PharmacistShift" WHERE available_to IS NOT NULL
  UNION ALL SELECT 'PharmacistShiftTemplate', 'available_from', org_id, created_at, available_from FROM "PharmacistShiftTemplate" WHERE available_from IS NOT NULL
  UNION ALL SELECT 'PharmacistShiftTemplate', 'available_to', org_id, created_at, available_to FROM "PharmacistShiftTemplate" WHERE available_to IS NOT NULL
  UNION ALL SELECT 'BusinessHoliday', 'open_time', org_id, created_at, open_time FROM "BusinessHoliday" WHERE open_time IS NOT NULL
  UNION ALL SELECT 'BusinessHoliday', 'close_time', org_id, created_at, close_time FROM "BusinessHoliday" WHERE close_time IS NOT NULL
  UNION ALL SELECT 'PharmacyOperatingHours', 'open_time', org_id, created_at, open_time FROM "PharmacyOperatingHours" WHERE open_time IS NOT NULL
  UNION ALL SELECT 'PharmacyOperatingHours', 'close_time', org_id, created_at, close_time FROM "PharmacyOperatingHours" WHERE close_time IS NOT NULL
  UNION ALL SELECT 'Facility', 'acceptance_time_from', org_id, created_at, acceptance_time_from FROM "Facility" WHERE acceptance_time_from IS NOT NULL
  UNION ALL SELECT 'Facility', 'acceptance_time_to', org_id, created_at, acceptance_time_to FROM "Facility" WHERE acceptance_time_to IS NOT NULL
  UNION ALL SELECT 'PatientSchedulePreference', 'preferred_time_from', org_id, created_at, preferred_time_from FROM "PatientSchedulePreference" WHERE preferred_time_from IS NOT NULL
  UNION ALL SELECT 'PatientSchedulePreference', 'preferred_time_to', org_id, created_at, preferred_time_to FROM "PatientSchedulePreference" WHERE preferred_time_to IS NOT NULL
  UNION ALL SELECT 'PatientSchedulePreference', 'phone_contact_from', org_id, created_at, phone_contact_from FROM "PatientSchedulePreference" WHERE phone_contact_from IS NOT NULL
  UNION ALL SELECT 'PatientSchedulePreference', 'phone_contact_to', org_id, created_at, phone_contact_to FROM "PatientSchedulePreference" WHERE phone_contact_to IS NOT NULL
  UNION ALL SELECT 'PatientSchedulePreference', 'facility_time_from', org_id, created_at, facility_time_from FROM "PatientSchedulePreference" WHERE facility_time_from IS NOT NULL
  UNION ALL SELECT 'PatientSchedulePreference', 'facility_time_to', org_id, created_at, facility_time_to FROM "PatientSchedulePreference" WHERE facility_time_to IS NOT NULL
),
aliased AS (
  SELECT dense_rank() OVER (ORDER BY org_id) AS org_scope,
         table_name,
         column_name,
         created_at,
         value
  FROM time_values
)
SELECT table_name,
       column_name,
       'org_scope_' || org_scope::text AS org_scope,
       date_trunc('day', created_at) AS created_day,
       count(*) AS rows,
       count(*) FILTER (WHERE value >= TIME '00:00' AND value < TIME '09:00') AS suspicious_early_rows
FROM aliased
GROUP BY table_name, column_name, org_scope, date_trunc('day', created_at)
ORDER BY created_day DESC, table_name, column_name, org_scope;
```

Finally run a release gate summary. `PASS` means no aggregate needs operator
review; `REVIEW_REQUIRED` means release must stop until every flagged aggregate
is explained as valid early-morning operation or covered by an approved
compatibility/backfill plan:

```sql
WITH time_values AS (
  SELECT 'VisitSchedule' AS table_name, 'time_window_start' AS column_name, org_id, created_at, time_window_start AS value FROM "VisitSchedule" WHERE time_window_start IS NOT NULL
  UNION ALL SELECT 'VisitSchedule', 'time_window_end', org_id, created_at, time_window_end FROM "VisitSchedule" WHERE time_window_end IS NOT NULL
  UNION ALL SELECT 'VisitSchedule', 'time_constraint_start', org_id, created_at, time_constraint_start FROM "VisitSchedule" WHERE time_constraint_start IS NOT NULL
  UNION ALL SELECT 'VisitSchedule', 'time_constraint_end', org_id, created_at, time_constraint_end FROM "VisitSchedule" WHERE time_constraint_end IS NOT NULL
  UNION ALL SELECT 'VisitScheduleProposal', 'time_window_start', org_id, created_at, time_window_start FROM "VisitScheduleProposal" WHERE time_window_start IS NOT NULL
  UNION ALL SELECT 'VisitScheduleProposal', 'time_window_end', org_id, created_at, time_window_end FROM "VisitScheduleProposal" WHERE time_window_end IS NOT NULL
  UNION ALL SELECT 'PharmacistShift', 'available_from', org_id, created_at, available_from FROM "PharmacistShift" WHERE available_from IS NOT NULL
  UNION ALL SELECT 'PharmacistShift', 'available_to', org_id, created_at, available_to FROM "PharmacistShift" WHERE available_to IS NOT NULL
  UNION ALL SELECT 'PharmacistShiftTemplate', 'available_from', org_id, created_at, available_from FROM "PharmacistShiftTemplate" WHERE available_from IS NOT NULL
  UNION ALL SELECT 'PharmacistShiftTemplate', 'available_to', org_id, created_at, available_to FROM "PharmacistShiftTemplate" WHERE available_to IS NOT NULL
  UNION ALL SELECT 'BusinessHoliday', 'open_time', org_id, created_at, open_time FROM "BusinessHoliday" WHERE open_time IS NOT NULL
  UNION ALL SELECT 'BusinessHoliday', 'close_time', org_id, created_at, close_time FROM "BusinessHoliday" WHERE close_time IS NOT NULL
  UNION ALL SELECT 'PharmacyOperatingHours', 'open_time', org_id, created_at, open_time FROM "PharmacyOperatingHours" WHERE open_time IS NOT NULL
  UNION ALL SELECT 'PharmacyOperatingHours', 'close_time', org_id, created_at, close_time FROM "PharmacyOperatingHours" WHERE close_time IS NOT NULL
  UNION ALL SELECT 'Facility', 'acceptance_time_from', org_id, created_at, acceptance_time_from FROM "Facility" WHERE acceptance_time_from IS NOT NULL
  UNION ALL SELECT 'Facility', 'acceptance_time_to', org_id, created_at, acceptance_time_to FROM "Facility" WHERE acceptance_time_to IS NOT NULL
  UNION ALL SELECT 'PatientSchedulePreference', 'preferred_time_from', org_id, created_at, preferred_time_from FROM "PatientSchedulePreference" WHERE preferred_time_from IS NOT NULL
  UNION ALL SELECT 'PatientSchedulePreference', 'preferred_time_to', org_id, created_at, preferred_time_to FROM "PatientSchedulePreference" WHERE preferred_time_to IS NOT NULL
  UNION ALL SELECT 'PatientSchedulePreference', 'phone_contact_from', org_id, created_at, phone_contact_from FROM "PatientSchedulePreference" WHERE phone_contact_from IS NOT NULL
  UNION ALL SELECT 'PatientSchedulePreference', 'phone_contact_to', org_id, created_at, phone_contact_to FROM "PatientSchedulePreference" WHERE phone_contact_to IS NOT NULL
  UNION ALL SELECT 'PatientSchedulePreference', 'facility_time_from', org_id, created_at, facility_time_from FROM "PatientSchedulePreference" WHERE facility_time_from IS NOT NULL
  UNION ALL SELECT 'PatientSchedulePreference', 'facility_time_to', org_id, created_at, facility_time_to FROM "PatientSchedulePreference" WHERE facility_time_to IS NOT NULL
),
pairs AS (
  SELECT 'VisitSchedule.time_window' AS pair_name, time_window_start AS starts_at, time_window_end AS ends_at FROM "VisitSchedule"
  UNION ALL SELECT 'VisitSchedule.time_constraint', time_constraint_start, time_constraint_end FROM "VisitSchedule"
  UNION ALL SELECT 'VisitScheduleProposal.time_window', time_window_start, time_window_end FROM "VisitScheduleProposal"
  UNION ALL SELECT 'PharmacistShift.available', available_from, available_to FROM "PharmacistShift"
  UNION ALL SELECT 'PharmacistShiftTemplate.available', available_from, available_to FROM "PharmacistShiftTemplate"
  UNION ALL SELECT 'BusinessHoliday.open', open_time, close_time FROM "BusinessHoliday"
  UNION ALL SELECT 'PharmacyOperatingHours.open', open_time, close_time FROM "PharmacyOperatingHours"
  UNION ALL SELECT 'Facility.acceptance', acceptance_time_from, acceptance_time_to FROM "Facility"
  UNION ALL SELECT 'PatientSchedulePreference.preferred', preferred_time_from, preferred_time_to FROM "PatientSchedulePreference"
  UNION ALL SELECT 'PatientSchedulePreference.phone_contact', phone_contact_from, phone_contact_to FROM "PatientSchedulePreference"
  UNION ALL SELECT 'PatientSchedulePreference.facility', facility_time_from, facility_time_to FROM "PatientSchedulePreference"
),
metrics AS (
  SELECT count(*) FILTER (WHERE value >= TIME '00:00' AND value < TIME '09:00') AS suspicious_early_rows,
         0::bigint AS missing_start_rows,
         0::bigint AS missing_end_rows,
         0::bigint AS non_increasing_rows,
         0::bigint AS duration_over_12h_rows
  FROM time_values
  UNION ALL
  SELECT 0,
         count(*) FILTER (WHERE starts_at IS NULL AND ends_at IS NOT NULL),
         count(*) FILTER (WHERE starts_at IS NOT NULL AND ends_at IS NULL),
         count(*) FILTER (WHERE starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at <= starts_at),
         count(*) FILTER (
           WHERE starts_at IS NOT NULL
             AND ends_at IS NOT NULL
             AND EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60 > 720
         )
  FROM pairs
)
SELECT CASE WHEN sum(suspicious_early_rows) = 0
              AND sum(missing_start_rows) = 0
              AND sum(missing_end_rows) = 0
              AND sum(non_increasing_rows) = 0
              AND sum(duration_over_12h_rows) = 0
            THEN 'PASS'
            ELSE 'REVIEW_REQUIRED'
       END AS release_gate,
       sum(suspicious_early_rows) AS suspicious_early_rows,
       sum(missing_start_rows) AS missing_start_rows,
       sum(missing_end_rows) AS missing_end_rows,
       sum(non_increasing_rows) AS non_increasing_rows,
       sum(duration_over_12h_rows) AS duration_over_12h_rows
FROM metrics;
```

## Deployment Boundary

This is a hard release gate for shared and production databases. Proceed only
when every scoped column and pair check has no unexplained
`suspicious_early_rows`, missing pair rows, `non_increasing_rows`, or
implausible-duration rows; or when each flagged aggregate is confirmed as valid
early-morning operation. Stop the release if old and new rows would sort,
validate, display, or plan routes differently and no read-compatibility or
approved backfill plan exists.

Do not ship the UTC-reader switch against a database that has possible legacy
local-written `@db.Time` rows unless one of these is attached to the release
ticket: a passing aggregate audit, an approved bounded backfill, or an approved
read-side compatibility plan. The audit evidence must not include raw `org_id`,
row IDs, patient identifiers, notes, addresses, phone numbers, or free text.

Never infer a `+9 hours` correction from aggregate counts alone. Any backfill
proposal must be a separate, idempotent, bounded plan based on a fresh
SELECT-only snapshot and non-PHI operational evidence.

## Rollback

If release validation shows schedule-time incompatibility:

1. Roll back application deployment to the last compatible version.
2. Do not mutate database rows during rollback without separate approval.
3. Re-run this SELECT-only audit and attach aggregate evidence to the release
   ticket.
4. Prepare an approved compatibility backfill or read-side compatibility patch
   before redeploying the UTC-safe writer.
