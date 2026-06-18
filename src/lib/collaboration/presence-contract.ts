export interface PresenceUser {
  user_id: string;
  display_name: string;
  active_field: string | null;
  updated_at: string;
}

const COLLABORATOR_COLOR_CLASSES = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-fuchsia-500',
  'bg-lime-500',
];

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readNonBlankString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function hashUserId(userId: string): number {
  let hash = 0;
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function getCollaboratorColorClass(userId: string): string {
  return (
    COLLABORATOR_COLOR_CLASSES[hashUserId(userId) % COLLABORATOR_COLOR_CLASSES.length] ??
    COLLABORATOR_COLOR_CLASSES[0]
  );
}

export function readPresenceUser(value: unknown): PresenceUser | null {
  const object = readRecord(value);
  if (!object) return null;

  const userId = readNonBlankString(object.user_id);
  const displayName = readNonBlankString(object.display_name);
  const updatedAt = readNonBlankString(object.updated_at);
  let activeField: string | null | undefined;
  if (object.active_field == null) {
    activeField = null;
  } else if (typeof object.active_field === 'string') {
    activeField = object.active_field.trim() || null;
  }

  if (!userId || !displayName || !updatedAt || activeField === undefined) return null;
  return {
    user_id: userId,
    display_name: displayName,
    active_field: activeField,
    updated_at: updatedAt,
  };
}

export function readPresenceUsersResponse(payload: unknown): PresenceUser[] {
  const object = readRecord(payload);
  const users = object?.data;
  if (!Array.isArray(users)) return [];
  return users.flatMap((user) => {
    const parsed = readPresenceUser(user);
    return parsed ? [parsed] : [];
  });
}

export function readPresenceUpdateEvent(
  payload: unknown,
  entityType: string,
  entityId: string,
): PresenceUser | null {
  const object = readRecord(payload);
  if (!object) return null;
  if (object.type !== 'presence_update') return null;
  if (object.entity_type !== entityType || object.entity_id !== entityId) return null;
  return readPresenceUser(object);
}

export function mergePresenceUserUpdate(
  currentUsers: readonly PresenceUser[],
  updatedUser: PresenceUser,
): PresenceUser[] {
  const existingIndex = currentUsers.findIndex((user) => user.user_id === updatedUser.user_id);
  if (existingIndex < 0) return [...currentUsers, updatedUser];

  const nextUsers = [...currentUsers];
  nextUsers[existingIndex] = updatedUser;
  return nextUsers;
}
