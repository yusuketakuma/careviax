-- Platform operator console — audited break-glass cross-tenant access.
-- See docs/design/platform-operator-console-design.md.
-- Purely additive: new platform-level enums + tables (no org_id, no RLS
-- tenant_isolation policy — access is gated at the application layer via
-- requirePlatformOperator). No changes to existing tenant tables.

-- CreateEnum
CREATE TYPE "PlatformOperatorRole" AS ENUM ('platform_support', 'platform_admin', 'platform_owner');

-- CreateEnum
CREATE TYPE "PlatformOperatorStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "BreakGlassScope" AS ENUM ('read_only', 'read_write');

-- CreateEnum
CREATE TYPE "BreakGlassStatus" AS ENUM ('active', 'expired', 'revoked');

-- CreateTable
CREATE TABLE "PlatformOperator" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "PlatformOperatorRole" NOT NULL,
    "status" "PlatformOperatorStatus" NOT NULL DEFAULT 'active',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformOperator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakGlassSession" (
    "id" TEXT NOT NULL,
    "operator_id" TEXT NOT NULL,
    "target_org_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reference_ticket" TEXT,
    "scope" "BreakGlassScope" NOT NULL DEFAULT 'read_only',
    "mfa_verified_at" TIMESTAMP(3) NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "status" "BreakGlassStatus" NOT NULL DEFAULT 'active',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BreakGlassSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformOperator_user_id_key" ON "PlatformOperator"("user_id");

-- CreateIndex
CREATE INDEX "PlatformOperator_status_idx" ON "PlatformOperator"("status");

-- CreateIndex
CREATE INDEX "BreakGlassSession_operator_id_status_idx" ON "BreakGlassSession"("operator_id", "status");

-- CreateIndex
CREATE INDEX "BreakGlassSession_target_org_id_granted_at_idx" ON "BreakGlassSession"("target_org_id", "granted_at");

-- CreateIndex
CREATE INDEX "BreakGlassSession_status_expires_at_idx" ON "BreakGlassSession"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "BreakGlassSession" ADD CONSTRAINT "BreakGlassSession_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "PlatformOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
