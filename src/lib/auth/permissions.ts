import type { MemberRole } from '@prisma/client';
import { forbidden } from '@/lib/api/response';
import { hasPermission, type PermissionKey } from './permission-matrix';

export { hasPermission };
export type { PermissionKey };

export function forbiddenIfMissingPermission(
  role: MemberRole,
  permission: PermissionKey,
  message = '権限がありません',
) {
  return hasPermission(role, permission) ? null : forbidden(message);
}

export function requirePermission(role: MemberRole, permission: PermissionKey): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Permission denied: ${permission} for role ${role}`);
  }
}
