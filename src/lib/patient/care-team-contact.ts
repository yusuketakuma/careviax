export type CareTeamContactRole =
  | 'physician'
  | 'nurse'
  | 'care_manager'
  | 'pharmacist'
  | 'other'
  | string;

export type CareTeamContactBadge = {
  label: string;
  tone: 'alert' | 'ok' | 'muted';
};

export type CareTeamContactLike = {
  role: string;
  phone?: string | null;
  email?: string | null;
  fax?: string | null;
  is_primary?: boolean | null;
};

export type CareTeamCaseLike = {
  status?: string | null;
};

export type PatientContactLike = {
  is_primary?: boolean | null;
  is_emergency_contact?: boolean | null;
  phone?: string | null;
  email?: string | null;
  fax?: string | null;
};

export type PatientContactPrimaryLike = {
  is_primary?: boolean | null;
};

export type PatientContactReadiness = {
  ready: boolean;
  detail: string;
};

export type CareTeamReliabilitySummary = {
  needs_confirmation: boolean;
  alert_count: number;
  detail: string;
  missing_role_labels: string[];
  phone_missing_role_labels: string[];
  fax_missing_role_labels: string[];
};

export type CareTeamContactChannelReadiness = {
  ready: boolean;
  warnings: string[];
  missing_channel_labels: string[];
};

export const REQUIRED_CARE_TEAM_ROLES = [
  ['physician', '医師'],
  ['nurse', '訪看'],
  ['care_manager', 'ケアマネ'],
] as const;

const DOCUMENT_CHANNEL_ROLES = new Set(['physician', 'nurse', 'care_manager']);

export function normalizeCareTeamRole(role: string) {
  if (['physician', 'doctor', 'clinic', 'prescriber'].includes(role)) return 'physician';
  if (['nurse', 'visiting_nurse', 'home_nurse'].includes(role)) return 'nurse';
  if (['care_manager', 'caremanager', 'cm'].includes(role)) return 'care_manager';
  return role;
}

export function pickPrimaryCareTeamLink<T extends CareTeamContactLike>(links: T[], role: string) {
  const normalizedRole = normalizeCareTeamRole(role);
  return (
    [...links]
      .filter((link) => normalizeCareTeamRole(link.role) === normalizedRole)
      .sort(
        (left, right) => Number(Boolean(right.is_primary)) - Number(Boolean(left.is_primary)),
      )[0] ?? null
  );
}

export function selectPrimaryCareTeamCase<T extends CareTeamCaseLike>(cases: T[]) {
  return cases.find((careCase) => careCase.status === 'active') ?? cases[0] ?? null;
}

export function normalizePatientPrimaryContacts<T extends PatientContactPrimaryLike>(
  contacts: T[],
): T[] {
  if (contacts.length === 0) return contacts;
  let primaryAssigned = false;
  const hasRequestedPrimary = contacts.some((contact) => contact.is_primary === true);

  return contacts.map((contact, index) => {
    const shouldBePrimary = hasRequestedPrimary
      ? contact.is_primary === true && !primaryAssigned
      : index === 0;
    if (shouldBePrimary) primaryAssigned = true;
    return { ...contact, is_primary: shouldBePrimary };
  });
}

export function normalizeCareTeamPrimaryByRole<T extends CareTeamContactLike>(links: T[]): T[] {
  const roleHasRequestedPrimary = new Map<string, boolean>();
  for (const link of links) {
    const role = normalizeCareTeamRole(link.role);
    roleHasRequestedPrimary.set(
      role,
      (roleHasRequestedPrimary.get(role) ?? false) || link.is_primary === true,
    );
  }

  const rolePrimaryAssigned = new Set<string>();
  return links.map((link) => {
    const role = normalizeCareTeamRole(link.role);
    const hasRequestedPrimary = roleHasRequestedPrimary.get(role) === true;
    const shouldBePrimary = hasRequestedPrimary
      ? link.is_primary === true && !rolePrimaryAssigned.has(role)
      : !rolePrimaryAssigned.has(role);
    if (shouldBePrimary) rolePrimaryAssigned.add(role);
    return { ...link, is_primary: shouldBePrimary };
  });
}

export function formatCareTeamContactChannels(contact: {
  phone?: string | null;
  fax?: string | null;
  email?: string | null;
}) {
  return (
    [
      contact.phone?.trim() ? `TEL ${contact.phone.trim()}` : null,
      contact.fax?.trim() ? `FAX ${contact.fax.trim()}` : null,
      contact.email?.trim() ? contact.email.trim() : null,
    ]
      .filter((item): item is string => Boolean(item))
      .join(' / ') || null
  );
}

export function buildCareTeamContactChannelReadiness(
  contact: CareTeamContactLike,
): CareTeamContactChannelReadiness {
  const normalizedRole = normalizeCareTeamRole(contact.role);
  const hasPhone = Boolean(contact.phone?.trim());
  const hasEmail = Boolean(contact.email?.trim());
  const hasFax = Boolean(contact.fax?.trim());
  const hasAnyChannel = hasPhone || hasEmail || hasFax;
  const requiredRoleLabel = REQUIRED_CARE_TEAM_ROLES.find(([role]) => role === normalizedRole)?.[1];
  const missingChannelLabels = [
    !hasAnyChannel ? '連絡先' : null,
    requiredRoleLabel && !hasPhone ? '電話' : null,
    DOCUMENT_CHANNEL_ROLES.has(normalizedRole) && !hasFax ? 'FAX' : null,
  ].filter((item): item is string => Boolean(item));

  return {
    ready: missingChannelLabels.length === 0,
    warnings: missingChannelLabels.map((label) => `${label}未確認`),
    missing_channel_labels: missingChannelLabels,
  };
}

export function hasPatientContactChannel(contact: {
  phone?: string | null;
  email?: string | null;
  fax?: string | null;
}) {
  return Boolean(contact.phone?.trim() || contact.email?.trim() || contact.fax?.trim());
}

function hasPatientContactPhone(contact: { phone?: string | null }) {
  return Boolean(contact.phone?.trim());
}

export function buildPatientContactReadiness(args: {
  contacts: PatientContactLike[];
  preferredContactName?: string | null;
  preferredContactPhone?: string | null;
  visitBeforeContactRequired?: boolean | null;
}): PatientContactReadiness {
  const contactWithChannel = args.contacts.some(hasPatientContactChannel);
  const primaryOrEmergencyWithChannel = args.contacts.some(
    (contact) =>
      (contact.is_primary || contact.is_emergency_contact) && hasPatientContactChannel(contact),
  );
  const primaryOrEmergencyWithPhone = args.contacts.some(
    (contact) =>
      (contact.is_primary || contact.is_emergency_contact) && hasPatientContactPhone(contact),
  );
  const preferredContactHasPhone = Boolean(args.preferredContactPhone?.trim());
  const hasPreferredContact = Boolean(
    args.preferredContactName?.trim() || args.preferredContactPhone?.trim(),
  );
  const visitBeforeContactRequired = args.visitBeforeContactRequired === true;
  const ready =
    preferredContactHasPhone ||
    (visitBeforeContactRequired ? primaryOrEmergencyWithPhone : primaryOrEmergencyWithChannel) ||
    (!visitBeforeContactRequired && hasPreferredContact && contactWithChannel);
  const detail = ready
    ? '電話可能な主連絡先または緊急連絡先があります。'
    : visitBeforeContactRequired
      ? '訪問前連絡が必要ですが電話可能な連絡先が未確認です。'
      : hasPreferredContact
        ? '連絡先名はありますが連絡手段が未確認です。'
        : '主連絡先が未設定です。';

  return { ready, detail };
}

export function buildCareTeamReliabilitySummary(args: {
  contacts: PatientContactLike[];
  careTeamLinks: CareTeamContactLike[];
}): CareTeamReliabilitySummary {
  const emergencyContacts = args.contacts.filter((contact) => contact.is_emergency_contact);
  const hasEmergencyContact = emergencyContacts.length > 0;
  const emergencyContactHasPhone = emergencyContacts.some((contact) =>
    Boolean(contact.phone?.trim()),
  );
  const normalizedPrimaryLinks = normalizeCareTeamPrimaryByRole(args.careTeamLinks)
    .filter((link) => link.is_primary)
    .map((link) => ({
      role: normalizeCareTeamRole(link.role),
      readiness: buildCareTeamContactChannelReadiness(link),
    }));
  const missingRoleLabels = REQUIRED_CARE_TEAM_ROLES.flatMap(([role, label]) =>
    normalizedPrimaryLinks.some((link) => link.role === role) ? [] : [label],
  );
  const phoneMissingRoleLabels = REQUIRED_CARE_TEAM_ROLES.flatMap(([role, label]) =>
    normalizedPrimaryLinks.some(
      (link) => link.role === role && link.readiness.missing_channel_labels.includes('電話'),
    )
      ? [label]
      : [],
  );
  const faxMissingRoleLabels = REQUIRED_CARE_TEAM_ROLES.flatMap(([role, label]) =>
    normalizedPrimaryLinks.some(
      (link) => link.role === role && link.readiness.missing_channel_labels.includes('FAX'),
    )
      ? [label]
      : [],
  );
  const needsConfirmation =
    !hasEmergencyContact ||
    !emergencyContactHasPhone ||
    missingRoleLabels.length > 0 ||
    phoneMissingRoleLabels.length > 0 ||
    faxMissingRoleLabels.length > 0;
  const details = [
    hasEmergencyContact
      ? emergencyContactHasPhone
        ? '緊急連絡先あり'
        : '緊急連絡先の電話未確認'
      : '緊急連絡先未設定',
    missingRoleLabels.length > 0 ? `不足: ${missingRoleLabels.join('、')}` : null,
    phoneMissingRoleLabels.length > 0 ? `電話未確認: ${phoneMissingRoleLabels.join('、')}` : null,
    faxMissingRoleLabels.length > 0 ? `報告FAX未登録: ${faxMissingRoleLabels.join('、')}` : null,
  ].filter((item): item is string => Boolean(item));

  return {
    needs_confirmation: needsConfirmation,
    alert_count: needsConfirmation ? 1 : 0,
    detail: needsConfirmation
      ? details.join(' / ')
      : '緊急連絡先と主要連携先の連絡手段があります。',
    missing_role_labels: missingRoleLabels,
    phone_missing_role_labels: phoneMissingRoleLabels,
    fax_missing_role_labels: faxMissingRoleLabels,
  };
}

export function careTeamContactBadges(row: {
  role: CareTeamContactRole;
  fax?: string | null;
  email?: string | null;
  phone?: string | null;
}): CareTeamContactBadge[] {
  const normalizedRole = normalizeCareTeamRole(row.role);
  const hasFax = (row.fax ?? '').trim().length > 0;
  const hasEmail = (row.email ?? '').trim().length > 0;
  const hasPhone = (row.phone ?? '').trim().length > 0;

  if (!hasFax && !hasEmail && !hasPhone) {
    return [{ label: '連絡先未登録', tone: 'alert' }];
  }

  const badges: CareTeamContactBadge[] = [];
  if (DOCUMENT_CHANNEL_ROLES.has(normalizedRole)) {
    badges.push(
      hasFax ? { label: 'FAX登録済', tone: 'ok' } : { label: 'FAX未登録', tone: 'alert' },
    );
  } else if (hasFax) {
    badges.push({ label: 'FAX登録済', tone: 'ok' });
  }
  if (hasEmail) {
    badges.push({ label: 'メールOK', tone: 'ok' });
  }
  if (!hasFax && !hasEmail) {
    badges.push({ label: '電話のみ', tone: 'muted' });
  }
  return badges;
}
