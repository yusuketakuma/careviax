-- Additive display_id allocation counter table.
-- RLS is intentionally not enabled for this internal counter table; see
-- prisma/rls-policies.sql for the app-layer scoping contract.
CREATE TABLE "id_sequence" (
    "org_id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "next_value" BIGINT NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "id_sequence_pkey" PRIMARY KEY ("org_id", "prefix"),
    CONSTRAINT "id_sequence_org_id_not_empty_check" CHECK (length("org_id") > 0),
    CONSTRAINT "id_sequence_prefix_format_check" CHECK ("prefix" ~ '^[a-z]{1,6}$'),
    CONSTRAINT "id_sequence_next_value_positive_check" CHECK ("next_value" >= 1)
);

CREATE INDEX "id_sequence_prefix_idx" ON "id_sequence"("prefix");
