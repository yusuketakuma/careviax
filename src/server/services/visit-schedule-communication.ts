export const visitScheduleCommunicationChannelValues = [
  'phone',
  'fax',
  'email',
  'collaboration',
  'in_person',
] as const;

export type VisitScheduleCommunicationChannel =
  (typeof visitScheduleCommunicationChannelValues)[number];

export type VisitScheduleCommunicationTarget = {
  key: 'family' | 'facility' | 'nurse' | 'care_manager' | 'mcs';
  recipientRole: string;
  recipientName: string;
  contact: string | null;
};

export type VisitScheduleSchedulingPreferenceContext = {
  preferredContactMethod: string | null;
  visitBeforeContactRequired: boolean;
  mcsLinked: boolean;
  pharmacyDecisionDueDate: Date | null;
};

export type VisitScheduleContactFollowupTaskArgs = {
  orgId: string;
  proposalId: string;
  caseId: string;
  patientId: string;
  assignedTo: string | null;
  dueAt: Date;
  description: string;
};

type VisitScheduleContactRecord = {
  name: string;
  relation: string;
  phone: string | null;
  email: string | null;
  fax: string | null;
  is_primary: boolean;
};

type VisitScheduleCareTeamRecord = {
  role: string;
  name: string;
  phone: string | null;
  email: string | null;
  fax: string | null;
  is_primary: boolean;
};

function firstValue(...values: Array<string | null | undefined>) {
  return values.find((value) => Boolean(value)) ?? null;
}

export function buildVisitScheduleContactTaskKey(proposalId: string) {
  return `visit-contact-followup:${proposalId}`;
}

export function buildVisitScheduleContactFollowupTask(
  args: VisitScheduleContactFollowupTaskArgs
) {
  return {
    orgId: args.orgId,
    taskType: 'visit_contact_followup' as const,
    title: '患者への再架電が必要です',
    description: args.description,
    priority: 'high' as const,
    assignedTo: args.assignedTo,
    dueDate: args.dueAt,
    slaDueAt: args.dueAt,
    dedupeKey: buildVisitScheduleContactTaskKey(args.proposalId),
    relatedEntityType: 'visit_schedule_proposal' as const,
    relatedEntityId: args.proposalId,
    metadata: {
      case_id: args.caseId,
      patient_id: args.patientId,
    },
  };
}

export function resolveVisitScheduleCommunicationChannel(
  requestedChannel: VisitScheduleCommunicationChannel,
  preferredContactMethod: string | null
): VisitScheduleCommunicationChannel {
  if (!preferredContactMethod || preferredContactMethod === 'other') {
    return requestedChannel;
  }

  const methodToChannel: Record<string, VisitScheduleCommunicationChannel> = {
    phone: 'phone',
    fax: 'fax',
    email: 'email',
    mcs: 'collaboration',
  };

  return methodToChannel[preferredContactMethod] ?? requestedChannel;
}

export function buildVisitScheduleCommunicationTargets(args: {
  contacts: VisitScheduleContactRecord[];
  careTeamLinks: VisitScheduleCareTeamRecord[];
  channel: VisitScheduleCommunicationChannel;
  schedulingPreference: VisitScheduleSchedulingPreferenceContext;
}) {
  const effectiveChannel = resolveVisitScheduleCommunicationChannel(
    args.channel,
    args.schedulingPreference.preferredContactMethod
  );

  const sortedContacts = [...args.contacts].sort(
    (left, right) => Number(right.is_primary) - Number(left.is_primary)
  );
  const sortedCareTeam = [...args.careTeamLinks].sort(
    (left, right) => Number(right.is_primary) - Number(left.is_primary)
  );
  const contactField =
    effectiveChannel === 'fax' ? 'fax' : effectiveChannel === 'email' ? 'email' : 'phone';

  const familyContact = sortedContacts.find((contact) =>
    ['self', 'spouse', 'child', 'parent', 'sibling', 'other'].includes(contact.relation)
  );
  const facilityContact = sortedContacts.find((contact) => contact.relation === 'facility_staff');
  const nurseContact =
    sortedCareTeam.find((member) => member.role === 'nurse') ??
    sortedContacts.find((contact) => contact.relation === 'nurse');
  const careManagerContact =
    sortedCareTeam.find((member) => member.role === 'care_manager') ??
    sortedContacts.find((contact) => contact.relation === 'care_manager');

  const targets: Array<VisitScheduleCommunicationTarget | null> = [
    familyContact
      ? {
          key: 'family',
          recipientRole: 'family_share',
          recipientName: familyContact.name,
          contact: firstValue(familyContact[contactField], familyContact.phone),
        }
      : null,
    facilityContact
      ? {
          key: 'facility',
          recipientRole: 'facility_handoff',
          recipientName: facilityContact.name,
          contact: firstValue(facilityContact[contactField], facilityContact.phone),
        }
      : null,
    nurseContact
      ? {
          key: 'nurse',
          recipientRole: 'nurse_share',
          recipientName: nurseContact.name,
          contact: firstValue(nurseContact[contactField], nurseContact.phone),
        }
      : null,
    careManagerContact
      ? {
          key: 'care_manager',
          recipientRole: 'care_manager_report',
          recipientName: careManagerContact.name,
          contact: firstValue(careManagerContact[contactField], careManagerContact.phone),
        }
      : null,
  ];

  if (args.schedulingPreference.mcsLinked) {
    targets.push({
      key: 'mcs',
      recipientRole: 'mcs_collaboration',
      recipientName: 'MCS連携',
      contact: null,
    });
  }

  return targets.filter(
    (target): target is VisitScheduleCommunicationTarget => target != null
  );
}

export function toVisitScheduleCommunicationEventChannel(
  value: VisitScheduleCommunicationChannel
) {
  switch (value) {
    case 'fax':
      return 'fax';
    case 'email':
      return 'email';
    case 'in_person':
      return 'in_person';
    case 'collaboration':
      return 'email';
    default:
      return 'phone';
  }
}
