ALTER TABLE "PharmacyInvoice"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "PharmacyInvoiceTransitionIntent" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "idempotency_key_hash" TEXT NOT NULL,
    "request_fingerprint_hash" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "expected_version" INTEGER NOT NULL,
    "result_snapshot" JSONB,
    "completed_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyInvoiceTransitionIntent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PharmacyInvoiceTransitionIntent_expected_version_chk" CHECK ("expected_version" > 0),
    CONSTRAINT "PharmacyInvoiceTransitionIntent_idempotency_key_hash_chk" CHECK (length(trim("idempotency_key_hash")) >= 32),
    CONSTRAINT "PharmacyInvoiceTransitionIntent_request_fingerprint_hash_chk" CHECK (length(trim("request_fingerprint_hash")) >= 32)
);

CREATE UNIQUE INDEX "PharmacyInvoiceTransitionIntent_org_invoice_idempotency_key"
ON "PharmacyInvoiceTransitionIntent"("org_id", "invoice_id", "idempotency_key_hash");

CREATE INDEX "PharmacyInvoiceTransitionIntent_org_id_invoice_id_idx"
ON "PharmacyInvoiceTransitionIntent"("org_id", "invoice_id");

CREATE INDEX "PharmacyInvoiceTransitionIntent_org_id_created_at_idx"
ON "PharmacyInvoiceTransitionIntent"("org_id", "created_at");

ALTER TABLE "PharmacyInvoiceTransitionIntent"
ADD CONSTRAINT "PharmacyInvoiceTransitionIntent_invoice_id_org_id_fkey"
FOREIGN KEY ("invoice_id", "org_id") REFERENCES "PharmacyInvoice"("id", "org_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PharmacyInvoiceTransitionIntent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyInvoiceTransitionIntent";
CREATE POLICY tenant_isolation ON "PharmacyInvoiceTransitionIntent"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PharmacyInvoiceTransitionIntent" FORCE ROW LEVEL SECURITY;
