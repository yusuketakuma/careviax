-- PCA pump rentals are tenant-scoped asset records. Enforce the tenant boundary
-- and core lifecycle invariants at the database layer, not only in API routes.

DO $$
DECLARE
  cross_org_pump_count integer;
  cross_org_institution_count integer;
  invalid_date_count integer;
  invalid_return_state_count integer;
  duplicate_serial_count integer;
BEGIN
  SELECT COUNT(*)::int
    INTO cross_org_pump_count
  FROM "PcaPumpRental" AS rental
  JOIN "PcaPump" AS pump ON pump.id = rental.pump_id
  WHERE pump.org_id <> rental.org_id;

  IF cross_org_pump_count > 0 THEN
    RAISE EXCEPTION 'Cannot harden PCA rental pump tenant FK; % cross-org pump rental rows exist', cross_org_pump_count
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)::int
    INTO cross_org_institution_count
  FROM "PcaPumpRental" AS rental
  JOIN "PrescriberInstitution" AS institution ON institution.id = rental.institution_id
  WHERE institution.org_id <> rental.org_id;

  IF cross_org_institution_count > 0 THEN
    RAISE EXCEPTION 'Cannot harden PCA rental institution tenant FK; % cross-org institution rental rows exist', cross_org_institution_count
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)::int
    INTO invalid_date_count
  FROM "PcaPumpRental"
  WHERE ("due_at" IS NOT NULL AND "due_at" < "rented_at")
     OR ("returned_at" IS NOT NULL AND "returned_at" < "rented_at");

  IF invalid_date_count > 0 THEN
    RAISE EXCEPTION 'Cannot add PCA rental date constraints; % invalid date rows exist', invalid_date_count
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)::int
    INTO invalid_return_state_count
  FROM "PcaPumpRental"
  WHERE ("status" = 'returned' AND "returned_at" IS NULL)
     OR ("status" <> 'returned' AND "returned_at" IS NOT NULL);

  IF invalid_return_state_count > 0 THEN
    RAISE EXCEPTION 'Cannot add PCA rental returned-state constraint; % invalid returned-state rows exist', invalid_return_state_count
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)::int
    INTO duplicate_serial_count
  FROM (
    SELECT "org_id", "serial_number"
    FROM "PcaPump"
    WHERE "serial_number" IS NOT NULL
      AND btrim("serial_number") <> ''
    GROUP BY "org_id", "serial_number"
    HAVING COUNT(*) > 1
  ) AS duplicate_serials;

  IF duplicate_serial_count > 0 THEN
    RAISE EXCEPTION 'Cannot add PCA pump serial uniqueness; % duplicate serial groups exist', duplicate_serial_count
      USING ERRCODE = '23505';
  END IF;
END;
$$;

ALTER TABLE "PcaPump"
  ADD CONSTRAINT "PcaPump_id_org_id_key" UNIQUE ("id", "org_id");

ALTER TABLE "PrescriberInstitution"
  ADD CONSTRAINT "PrescriberInstitution_id_org_id_key" UNIQUE ("id", "org_id");

ALTER TABLE "PcaPumpRental"
  DROP CONSTRAINT IF EXISTS "PcaPumpRental_pump_id_fkey",
  DROP CONSTRAINT IF EXISTS "PcaPumpRental_institution_id_fkey",
  ADD CONSTRAINT "PcaPumpRental_pump_id_org_id_fkey"
    FOREIGN KEY ("pump_id", "org_id") REFERENCES "PcaPump"("id", "org_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PcaPumpRental_institution_id_org_id_fkey"
    FOREIGN KEY ("institution_id", "org_id") REFERENCES "PrescriberInstitution"("id", "org_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PcaPumpRental_due_at_after_rented_at_check"
    CHECK ("due_at" IS NULL OR "due_at" >= "rented_at"),
  ADD CONSTRAINT "PcaPumpRental_returned_at_after_rented_at_check"
    CHECK ("returned_at" IS NULL OR "returned_at" >= "rented_at"),
  ADD CONSTRAINT "PcaPumpRental_returned_status_date_check"
    CHECK (
      ("status" = 'returned' AND "returned_at" IS NOT NULL)
      OR ("status" <> 'returned' AND "returned_at" IS NULL)
    ),
  ADD CONSTRAINT "PcaPumpRental_rental_fee_yen_nonnegative_check"
    CHECK ("rental_fee_yen" IS NULL OR "rental_fee_yen" >= 0);

CREATE UNIQUE INDEX "PcaPump_org_id_serial_number_key"
  ON "PcaPump"("org_id", "serial_number")
  WHERE "serial_number" IS NOT NULL AND btrim("serial_number") <> '';

DROP TRIGGER IF EXISTS audit_log_pca_pump ON "PcaPump";
CREATE TRIGGER audit_log_pca_pump
AFTER INSERT OR UPDATE OR DELETE ON "PcaPump"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_pca_pump_rental ON "PcaPumpRental";
CREATE TRIGGER audit_log_pca_pump_rental
AFTER INSERT OR UPDATE OR DELETE ON "PcaPumpRental"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();
