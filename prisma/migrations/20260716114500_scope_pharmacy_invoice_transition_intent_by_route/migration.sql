ALTER TABLE "PharmacyInvoiceTransitionIntent"
ADD COLUMN "route_key" TEXT NOT NULL;

DROP INDEX "PharmacyInvoiceTransitionIntent_org_invoice_idempotency_key";

CREATE UNIQUE INDEX "PharmacyInvoiceTransitionIntent_org_route_invoice_idem_key"
ON "PharmacyInvoiceTransitionIntent"("org_id", "route_key", "invoice_id", "idempotency_key_hash");
