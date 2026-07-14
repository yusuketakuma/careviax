/**
 * Tenant-shaped infrastructure tables that intentionally do not use RLS.
 *
 * These are not unresolved security gaps: each entry needs an explicit SSOT
 * justification and an application-layer access ratchet. Contract tests and
 * live preflight checks consume this exact model/table mapping so Prisma model
 * names cannot drift from mapped PostgreSQL table names.
 */
export const INTENTIONAL_RLS_EXCLUSIONS = [
  {
    model: 'IdSequence',
    table: 'id_sequence',
  },
] as const;
