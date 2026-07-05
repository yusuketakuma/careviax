import type { MemberRole } from '@prisma/client';

const CLINICAL_FINALIZER_ROLES = new Set<MemberRole>(['owner', 'admin', 'pharmacist']);

export function canFinalizeClinicalState(role: MemberRole) {
  return CLINICAL_FINALIZER_ROLES.has(role);
}
