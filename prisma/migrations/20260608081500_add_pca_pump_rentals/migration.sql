CREATE TYPE "PcaPumpStatus" AS ENUM (
  'available',
  'rented',
  'maintenance',
  'retired'
);

CREATE TYPE "PcaPumpRentalStatus" AS ENUM (
  'scheduled',
  'active',
  'overdue',
  'returned',
  'cancelled'
);

CREATE TABLE "PcaPump" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "asset_code" TEXT NOT NULL,
  "serial_number" TEXT,
  "model_name" TEXT NOT NULL,
  "manufacturer" TEXT,
  "status" "PcaPumpStatus" NOT NULL DEFAULT 'available',
  "maintenance_due_at" DATE,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PcaPump_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PcaPumpRental" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "pump_id" TEXT NOT NULL,
  "institution_id" TEXT NOT NULL,
  "status" "PcaPumpRentalStatus" NOT NULL DEFAULT 'scheduled',
  "rented_at" DATE NOT NULL,
  "due_at" DATE,
  "returned_at" DATE,
  "contact_name" TEXT,
  "contact_phone" TEXT,
  "rental_fee_yen" INTEGER,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PcaPumpRental_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PcaPump_org_id_asset_code_key"
  ON "PcaPump"("org_id", "asset_code");

CREATE INDEX "PcaPump_org_id_status_idx"
  ON "PcaPump"("org_id", "status");

CREATE INDEX "PcaPump_org_id_serial_number_idx"
  ON "PcaPump"("org_id", "serial_number");

CREATE INDEX "PcaPumpRental_org_id_status_idx"
  ON "PcaPumpRental"("org_id", "status");

CREATE INDEX "PcaPumpRental_org_id_pump_id_idx"
  ON "PcaPumpRental"("org_id", "pump_id");

CREATE INDEX "PcaPumpRental_org_id_institution_id_idx"
  ON "PcaPumpRental"("org_id", "institution_id");

CREATE INDEX "PcaPumpRental_org_id_due_at_idx"
  ON "PcaPumpRental"("org_id", "due_at");

ALTER TABLE "PcaPump"
  ADD CONSTRAINT "PcaPump_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PcaPumpRental"
  ADD CONSTRAINT "PcaPumpRental_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PcaPumpRental"
  ADD CONSTRAINT "PcaPumpRental_pump_id_fkey"
  FOREIGN KEY ("pump_id") REFERENCES "PcaPump"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PcaPumpRental"
  ADD CONSTRAINT "PcaPumpRental_institution_id_fkey"
  FOREIGN KEY ("institution_id") REFERENCES "PrescriberInstitution"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
