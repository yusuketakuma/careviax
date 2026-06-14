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

// チャネルは「明示的に要求されたもの」または「患者側が明示的に希望したもの」のみを
// 採用する。preferredContactMethod が未設定/不明な場合でも fax を黙って既定にはせず、
// 呼び出し側が明示指定した requestedChannel をそのまま使う（暗黙の fax 既定を作らない）。
// なお fax は記録専用チャネル（FAX ゲートウェイ未実装）であり、本サービスからも自動
// 送信は行わない。fax が選ばれるのは患者が明示的に FAX を希望した場合のみで、その実体は
// 手動送付の記録として communication event に残るだけである。
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
    // recipient_role は宛先区分の正規タクソノミー(physician/care_manager/visiting_nurse/
    // facility/family/mcs)で統一する。報告/引継/共有といった意図は template_key/request_type
    // 側で表現されるため、ここを正規値にしても情報は失われない。これにより返信フロー側の
    // 正規化(audienceKeyFromRecipientRole)と突合でき、返信が宛先列に表示される。
    familyContact
      ? {
          key: 'family',
          recipientRole: 'family',
          recipientName: familyContact.name,
          contact: firstValue(familyContact[contactField], familyContact.phone),
        }
      : null,
    facilityContact
      ? {
          key: 'facility',
          recipientRole: 'facility',
          recipientName: facilityContact.name,
          contact: firstValue(facilityContact[contactField], facilityContact.phone),
        }
      : null,
    nurseContact
      ? {
          key: 'nurse',
          recipientRole: 'visiting_nurse',
          recipientName: nurseContact.name,
          contact: firstValue(nurseContact[contactField], nurseContact.phone),
        }
      : null,
    careManagerContact
      ? {
          key: 'care_manager',
          recipientRole: 'care_manager',
          recipientName: careManagerContact.name,
          contact: firstValue(careManagerContact[contactField], careManagerContact.phone),
        }
      : null,
  ];

  if (args.schedulingPreference.mcsLinked) {
    targets.push({
      key: 'mcs',
      recipientRole: 'mcs',
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
