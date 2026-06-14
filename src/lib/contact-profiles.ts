import type { CommunicationChannel, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

type DbClient = Prisma.TransactionClient | typeof prisma;

type ChannelStatsDbClient = {
  deliveryRecord: {
    findMany(args: unknown): Promise<Array<{
      recipient_name: string;
      channel: CommunicationChannel;
      status: string;
    }>>;
  };
  communicationEvent: {
    findMany(args: unknown): Promise<Array<{
      counterpart_name: string | null;
      channel: CommunicationChannel;
      event_type: string;
    }>>;
  };
};

type ExternalProfessionalSuggestionsDbClient = ChannelStatsDbClient & {
  careCase: {
    findMany(args: unknown): Promise<Array<{
      id: string;
      care_team_links: Array<{
        id: string;
        is_primary: boolean;
        role: string | null;
        name: string | null;
        organization_name: string | null;
        department: string | null;
        phone: string | null;
        email: string | null;
        fax: string | null;
        address: string | null;
        external_professional_id: string | null;
        external_professional: {
          id: string;
          name: string;
          profession_type: string;
          organization_name: string | null;
          department: string | null;
          phone: string | null;
          email: string | null;
          fax: string | null;
          address: string | null;
          preferred_contact_method: CommunicationChannel | null;
          preferred_contact_time: string | null;
          last_contacted_at: Date | null;
          last_success_channel: CommunicationChannel | null;
        } | null;
      }>;
    }>>;
  };
};

type ExternalProfessionalSuggestion = {
  id: string;
  name: string;
  profession_type: string;
  organization_name: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  address: string | null;
  preferred_contact_method: CommunicationChannel | null;
  preferred_contact_time: string | null;
  last_contacted_at: Date | null;
  last_success_channel: CommunicationChannel | null;
  recommended_channels: CommunicationChannel[];
  is_primary: boolean;
  source: 'patient_care_team' | 'external_professional_master';
};

export type ContactProfileKind =
  | 'facility_contact'
  | 'external_professional'
  | 'prescriber_institution';

/**
 * 送付方法（送付先・連絡先の編集 p0_26）で選択可能なチャネル一覧。
 * 既定は PH-OS 内共有。表示順は設計（PH-OS共有 / FAX / 電話 / メール / 郵送 / 対面）に合わせる。
 */
export const CONTACT_METHOD_OPTIONS = [
  'ph_os_share',
  'fax',
  'phone',
  'email',
  'postal',
  'in_person',
] as const satisfies readonly CommunicationChannel[];

export const CONTACT_METHOD_LABELS: Record<CommunicationChannel, string> = {
  ph_os_share: 'PH-OS共有',
  fax: 'FAX',
  phone: '電話',
  email: 'メール',
  postal: '郵送',
  in_person: '対面',
  ses: 'SESメール',
};

export function contactMethodLabel(value: CommunicationChannel | string | null | undefined) {
  if (!value) return '未設定';
  return CONTACT_METHOD_LABELS[value as CommunicationChannel] ?? value;
}

type ContactProfileRow = {
  id: string;
  kind: ContactProfileKind;
  name: string;
  subtitle: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  preferred_contact_method: CommunicationChannel | null;
  preferred_contact_time: string | null;
  last_contacted_at: Date | null;
  last_success_channel: CommunicationChannel | null;
  recommended_channels: CommunicationChannel[];
  active_patient_count: number;
  pending_response_count: number;
};

const CHANNEL_PRIORITY: CommunicationChannel[] = [
  'fax',
  'email',
  'phone',
  'ses',
  'postal',
  'in_person',
];

type ChannelStats = Record<
  CommunicationChannel,
  {
    success: number;
    failure: number;
  }
>;

function createEmptyChannelStats(): ChannelStats {
  return {
    ph_os_share: { success: 0, failure: 0 },
    email: { success: 0, failure: 0 },
    fax: { success: 0, failure: 0 },
    phone: { success: 0, failure: 0 },
    in_person: { success: 0, failure: 0 },
    postal: { success: 0, failure: 0 },
    ses: { success: 0, failure: 0 },
  };
}

function deriveAvailableChannels(input: {
  phone?: string | null;
  email?: string | null;
  fax?: string | null;
  address?: string | null;
  preferred?: CommunicationChannel | null;
}) {
  const available = new Set<CommunicationChannel>();
  if (input.phone) available.add('phone');
  if (input.email) {
    available.add('email');
    available.add('ses');
  }
  if (input.fax) available.add('fax');
  if (input.address) {
    available.add('postal');
    available.add('in_person');
  }
  if (
    input.preferred &&
    ((input.preferred === 'phone' && input.phone) ||
      ((input.preferred === 'email' || input.preferred === 'ses') && input.email) ||
      (input.preferred === 'fax' && input.fax) ||
      ((input.preferred === 'postal' || input.preferred === 'in_person') && input.address))
  ) {
    available.add(input.preferred);
  }
  return available;
}

export function getRecommendedChannels(input: {
  preferred?: CommunicationChannel | null;
  stats?: ChannelStats;
  phone?: string | null;
  email?: string | null;
  fax?: string | null;
  address?: string | null;
}) {
  const available = deriveAvailableChannels(input);
  const ranked = CHANNEL_PRIORITY.filter((channel) => available.has(channel)).sort(
    (left, right) => {
      if (input.preferred === left && input.preferred !== right) return -1;
      if (input.preferred === right && input.preferred !== left) return 1;

      const leftStats = input.stats?.[left] ?? { success: 0, failure: 0 };
      const rightStats = input.stats?.[right] ?? { success: 0, failure: 0 };
      const leftScore = leftStats.success * 10 - leftStats.failure * 4;
      const rightScore = rightStats.success * 10 - rightStats.failure * 4;

      if (leftScore !== rightScore) return rightScore - leftScore;
      if (leftStats.success !== rightStats.success) {
        return rightStats.success - leftStats.success;
      }
      if (leftStats.failure !== rightStats.failure) {
        return leftStats.failure - rightStats.failure;
      }
      return CHANNEL_PRIORITY.indexOf(left) - CHANNEL_PRIORITY.indexOf(right);
    }
  );

  return ranked;
}

export async function getChannelStatsByName(
  db: DbClient,
  orgId: string,
  names: string[]
): Promise<Map<string, ChannelStats>>;
export async function getChannelStatsByName(
  db: ChannelStatsDbClient,
  orgId: string,
  names: string[]
): Promise<Map<string, ChannelStats>>;
export async function getChannelStatsByName(
  db: DbClient | ChannelStatsDbClient,
  orgId: string,
  names: string[]
) {
  const reader = db as ChannelStatsDbClient;
  const uniqueNames = Array.from(
    new Set(names.map((name) => name.trim()).filter((name) => name.length > 0))
  );
  const statsMap = new Map<string, ChannelStats>();
  if (uniqueNames.length === 0) return statsMap;

  const [deliveries, events] = await Promise.all([
    reader.deliveryRecord.findMany({
      where: {
        org_id: orgId,
        recipient_name: { in: uniqueNames },
      },
      select: {
        recipient_name: true,
        channel: true,
        status: true,
      },
    }),
    reader.communicationEvent.findMany({
      where: {
        org_id: orgId,
        direction: 'outbound',
        counterpart_name: { in: uniqueNames },
      },
      select: {
        counterpart_name: true,
        channel: true,
        event_type: true,
      },
    }),
  ]);

  function ensure(name: string) {
    const current = statsMap.get(name);
    if (current) return current;
    const created = createEmptyChannelStats();
    statsMap.set(name, created);
    return created;
  }

  for (const delivery of deliveries) {
    const stats = ensure(delivery.recipient_name);
    if (delivery.status === 'failed') {
      stats[delivery.channel].failure += 1;
    } else if (delivery.status !== 'draft') {
      stats[delivery.channel].success += 1;
    }
  }

  for (const event of events) {
    if (!event.counterpart_name) continue;
    const stats = ensure(event.counterpart_name);
    if (event.event_type === 'delivery_failure') {
      stats[event.channel].failure += 1;
    } else {
      stats[event.channel].success += 1;
    }
  }

  return statsMap;
}

function buildRolePreference(requestType: string | null | undefined) {
  if (!requestType) return null;
  if (requestType.includes('care_manager')) return 'care_manager';
  if (requestType.includes('physician') || requestType === 'inquiry') return 'physician';
  return null;
}

export async function findExternalProfessionalSuggestions(
  db: DbClient,
  orgId: string,
  input: {
    patientId?: string | null;
    caseId?: string | null;
  }
): Promise<ExternalProfessionalSuggestion[]>;
export async function findExternalProfessionalSuggestions(
  db: ExternalProfessionalSuggestionsDbClient,
  orgId: string,
  input: {
    patientId?: string | null;
    caseId?: string | null;
  }
): Promise<ExternalProfessionalSuggestion[]>;
export async function findExternalProfessionalSuggestions(
  db: DbClient | ExternalProfessionalSuggestionsDbClient,
  orgId: string,
  input: {
    patientId?: string | null;
    caseId?: string | null;
  }
): Promise<ExternalProfessionalSuggestion[]> {
  if (!input.patientId && !input.caseId) return [];

  const reader = db as ExternalProfessionalSuggestionsDbClient;
  const cases = await reader.careCase.findMany({
    where: {
      org_id: orgId,
      ...(input.caseId ? { id: input.caseId } : {}),
      ...(input.patientId ? { patient_id: input.patientId } : {}),
    },
    select: {
      id: true,
      care_team_links: {
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        select: {
          id: true,
          is_primary: true,
          role: true,
          name: true,
          organization_name: true,
          department: true,
          phone: true,
          email: true,
          fax: true,
          address: true,
          external_professional_id: true,
          external_professional: {
            select: {
              id: true,
              name: true,
              profession_type: true,
              organization_name: true,
              department: true,
              phone: true,
              email: true,
              fax: true,
              address: true,
              preferred_contact_method: true,
              preferred_contact_time: true,
              last_contacted_at: true,
              last_success_channel: true,
            },
          },
        },
      },
    },
  });

  const deduped = new Map<string, ExternalProfessionalSuggestion>();
  for (const careCase of cases) {
    for (const link of careCase.care_team_links) {
      const professional = link.external_professional;
      const candidateKey = link.external_professional_id
        ? `external:${link.external_professional_id}`
        : `care-team:${link.role}:${link.name}:${link.organization_name ?? ''}:${link.phone ?? ''}:${link.email ?? ''}:${link.fax ?? ''}`;

      if (deduped.has(candidateKey)) continue;

      const name = link.name || professional?.name;
      if (!name) continue;

      deduped.set(candidateKey, {
        id: professional?.id ?? `care-team:${link.id}`,
        name,
        profession_type: link.role || professional?.profession_type || 'other',
        organization_name: link.organization_name ?? professional?.organization_name ?? null,
        department: link.department ?? professional?.department ?? null,
        phone: link.phone ?? professional?.phone ?? null,
        email: link.email ?? professional?.email ?? null,
        fax: link.fax ?? professional?.fax ?? null,
        address: link.address ?? professional?.address ?? null,
        preferred_contact_method: professional?.preferred_contact_method ?? null,
        preferred_contact_time: professional?.preferred_contact_time ?? null,
        last_contacted_at: professional?.last_contacted_at ?? null,
        last_success_channel: professional?.last_success_channel ?? null,
        recommended_channels: [],
        is_primary: link.is_primary,
        source: link.external_professional_id ? 'external_professional_master' : 'patient_care_team',
      });
    }
  }

  const channelStatsByName = await getChannelStatsByName(
    reader,
    orgId,
    Array.from(deduped.values()).map((item) => item.name)
  );

  for (const [id, suggestion] of deduped.entries()) {
    deduped.set(id, {
      ...suggestion,
      recommended_channels: getRecommendedChannels({
        preferred: suggestion.preferred_contact_method,
        stats: channelStatsByName.get(suggestion.name),
        phone: suggestion.phone,
        email: suggestion.email,
        fax: suggestion.fax,
        address: suggestion.address,
      }),
    });
  }

  return Array.from(deduped.values()).sort((left, right) => {
    if (left.is_primary !== right.is_primary) {
      return left.is_primary ? -1 : 1;
    }
    return left.name.localeCompare(right.name, 'ja');
  });
}

export async function pickCommunicationRecipientCandidate(
  db: DbClient,
  orgId: string,
  input: {
    patientId?: string | null;
    caseId?: string | null;
    requestType?: string | null;
  }
) {
  const suggestions = await findExternalProfessionalSuggestions(db, orgId, input);
  if (suggestions.length === 0) return null;

  const preferredRole = buildRolePreference(input.requestType);
  const matched =
    (preferredRole
      ? suggestions.find((candidate) => candidate.profession_type === preferredRole)
      : null) ?? suggestions[0];

  return matched;
}

export async function learnContactProfileFromCommunication(
  db: DbClient,
  input: {
    orgId: string;
    counterpartName?: string | null;
    counterpartContact?: string | null;
    channel: CommunicationChannel;
    occurredAt: Date;
    markSuccess?: boolean;
  }
) {
  const counterpartName = input.counterpartName?.trim() || null;
  const counterpartContact = input.counterpartContact?.trim() || null;
  if (!counterpartName && !counterpartContact) return;

  const nextData = {
    last_contacted_at: input.occurredAt,
    ...(input.markSuccess
      ? {
          last_success_channel: input.channel,
          preferred_contact_method: input.channel,
        }
      : {}),
  };

  const tasks: Promise<unknown>[] = [];

  if (typeof db.prescriberInstitution?.updateMany === 'function') {
    tasks.push(
      db.prescriberInstitution.updateMany({
        where: {
          org_id: input.orgId,
          OR: [
            ...(counterpartName ? [{ name: counterpartName }] : []),
            ...(counterpartContact
              ? [{ phone: counterpartContact }, { fax: counterpartContact }]
              : []),
          ],
        },
        data: nextData,
      })
    );
  }

  if (typeof db.externalProfessional?.updateMany === 'function') {
    tasks.push(
      db.externalProfessional.updateMany({
        where: {
          org_id: input.orgId,
          OR: [
            ...(counterpartName ? [{ name: counterpartName }] : []),
            ...(counterpartContact
              ? [
                  { phone: counterpartContact },
                  { fax: counterpartContact },
                  { email: counterpartContact },
                ]
              : []),
          ],
        },
        data: nextData,
      })
    );
  }

  if (typeof db.facilityContact?.updateMany === 'function') {
    tasks.push(
      db.facilityContact.updateMany({
        where: {
          org_id: input.orgId,
          OR: [
            ...(counterpartName ? [{ name: counterpartName }] : []),
            ...(counterpartContact
              ? [
                  { phone: counterpartContact },
                  { fax: counterpartContact },
                  { email: counterpartContact },
                ]
              : []),
          ],
        },
        data: nextData,
      })
    );
  }

  await Promise.all(tasks);
}

export async function listContactProfiles(
  db: DbClient,
  orgId: string,
  input: {
    kind?: ContactProfileRow['kind'] | 'all' | null;
    query?: string | null;
  }
): Promise<ContactProfileRow[]> {
  const query = input.query?.trim() || null;
  const matchesQuery = (fields: Array<string | null | undefined>) =>
    !query ||
    fields.some((field) => field?.toLowerCase().includes(query.toLowerCase()));

  const [facilityContacts, externalProfessionals, prescriberInstitutions] = await Promise.all([
    input.kind && input.kind !== 'all' && input.kind !== 'facility_contact'
      ? Promise.resolve([])
      : db.facilityContact.findMany({
          where: { org_id: orgId },
          include: {
            facility: {
              select: {
                name: true,
                address: true,
                residences: {
                  select: {
                    patient_id: true,
                  },
                },
              },
            },
          },
          orderBy: [{ name: 'asc' }],
        }),
    input.kind && input.kind !== 'all' && input.kind !== 'external_professional'
      ? Promise.resolve([])
      : db.externalProfessional.findMany({
          where: { org_id: orgId },
          include: {
            care_team_links: {
              select: {
                case_: {
                  select: {
                    patient_id: true,
                    status: true,
                  },
                },
              },
            },
          },
          orderBy: [{ name: 'asc' }],
        }),
    input.kind && input.kind !== 'all' && input.kind !== 'prescriber_institution'
      ? Promise.resolve([])
      : db.prescriberInstitution.findMany({
          where: { org_id: orgId },
          include: {
            prescription_intakes: {
              select: {
                cycle: {
                  select: {
                    patient_id: true,
                  },
                },
              },
            },
          },
          orderBy: [{ name: 'asc' }],
        }),
  ]);

  const channelStatsByName = await getChannelStatsByName(
    db,
    orgId,
    [
      ...facilityContacts.map((item) => item.name),
      ...externalProfessionals.map((item) => item.name),
      ...prescriberInstitutions.map((item) => item.name),
    ]
  );

  const [facilityPending, externalPending, prescriberPending] = await Promise.all([
    facilityContacts.length === 0
      ? Promise.resolve([])
      : db.communicationRequest.groupBy({
          by: ['recipient_name'],
          where: {
            org_id: orgId,
            recipient_name: {
              in: facilityContacts.map((item) => item.name),
            },
            status: {
              in: ['draft', 'sent', 'received', 'in_progress', 'escalated'],
            },
          },
          _count: {
            _all: true,
          },
        }),
    externalProfessionals.length === 0
      ? Promise.resolve([])
      : db.communicationRequest.groupBy({
          by: ['recipient_name'],
          where: {
            org_id: orgId,
            recipient_name: {
              in: externalProfessionals.map((item) => item.name),
            },
            status: {
              in: ['draft', 'sent', 'received', 'in_progress', 'escalated'],
            },
          },
          _count: {
            _all: true,
          },
        }),
    prescriberInstitutions.length === 0
      ? Promise.resolve([])
      : db.communicationRequest.groupBy({
          by: ['recipient_name'],
          where: {
            org_id: orgId,
            recipient_name: {
              in: prescriberInstitutions.map((item) => item.name),
            },
            status: {
              in: ['draft', 'sent', 'received', 'in_progress', 'escalated'],
            },
          },
          _count: {
            _all: true,
          },
        }),
  ]);

  const facilityPendingMap = new Map(
    facilityPending.map((item) => [item.recipient_name, item._count._all])
  );
  const externalPendingMap = new Map(
    externalPending.map((item) => [item.recipient_name, item._count._all])
  );
  const prescriberPendingMap = new Map(
    prescriberPending.map((item) => [item.recipient_name, item._count._all])
  );

  const rows: ContactProfileRow[] = [
    ...facilityContacts.map((item) => ({
      id: item.id,
      kind: 'facility_contact' as const,
      name: item.name,
      subtitle: item.role ? `${item.facility.name} / ${item.role}` : item.facility.name,
      phone: item.phone,
      email: item.email,
      fax: item.fax,
      preferred_contact_method: item.preferred_contact_method,
      preferred_contact_time: item.preferred_contact_time,
      last_contacted_at: item.last_contacted_at,
      last_success_channel: item.last_success_channel,
      recommended_channels: getRecommendedChannels({
        preferred: item.preferred_contact_method,
        stats: channelStatsByName.get(item.name),
        phone: item.phone,
        email: item.email,
        fax: item.fax,
        address: item.facility.address,
      }),
      active_patient_count: new Set(item.facility.residences.map((residence) => residence.patient_id)).size,
      pending_response_count: facilityPendingMap.get(item.name) ?? 0,
    })),
    ...externalProfessionals.map((item) => ({
      id: item.id,
      kind: 'external_professional' as const,
      name: item.name,
      subtitle: item.organization_name ?? item.profession_type,
      phone: item.phone,
      email: item.email,
      fax: item.fax,
      preferred_contact_method: item.preferred_contact_method,
      preferred_contact_time: item.preferred_contact_time,
      last_contacted_at: item.last_contacted_at,
      last_success_channel: item.last_success_channel,
      recommended_channels: getRecommendedChannels({
        preferred: item.preferred_contact_method,
        stats: channelStatsByName.get(item.name),
        phone: item.phone,
        email: item.email,
        fax: item.fax,
        address: item.address,
      }),
      active_patient_count: new Set(
        item.care_team_links
          .filter((link) => link.case_?.status !== 'terminated')
          .map((link) => link.case_?.patient_id)
          .filter((value): value is string => Boolean(value))
      ).size,
      pending_response_count: externalPendingMap.get(item.name) ?? 0,
    })),
    ...prescriberInstitutions.map((item) => ({
      id: item.id,
      kind: 'prescriber_institution' as const,
      name: item.name,
      subtitle: item.institution_code ?? '処方元医療機関',
      phone: item.phone,
      email: null,
      fax: item.fax,
      preferred_contact_method: item.preferred_contact_method,
      preferred_contact_time: item.preferred_contact_time,
      last_contacted_at: item.last_contacted_at,
      last_success_channel: item.last_success_channel,
      recommended_channels: getRecommendedChannels({
        preferred: item.preferred_contact_method,
        stats: channelStatsByName.get(item.name),
        phone: item.phone,
        fax: item.fax,
        address: item.address,
      }),
      active_patient_count: new Set(
        item.prescription_intakes
          .map((intake) => intake.cycle?.patient_id)
          .filter((value): value is string => Boolean(value))
      ).size,
      pending_response_count: prescriberPendingMap.get(item.name) ?? 0,
    })),
  ];

  return rows
    .filter((row) =>
      matchesQuery([row.name, row.subtitle, row.phone, row.email, row.fax])
    )
    .sort((left, right) => {
      const kindOrder = ['facility_contact', 'external_professional', 'prescriber_institution'];
      const kindDelta = kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind);
      if (kindDelta !== 0) return kindDelta;
      return left.name.localeCompare(right.name, 'ja');
    });
}

export type ContactProfileUpdateInput = {
  name?: string;
  role?: string | null;
  department?: string | null;
  phone?: string | null;
  email?: string | null;
  fax?: string | null;
  preferred_contact_method?: CommunicationChannel | null;
  preferred_contact_time?: string | null;
};

/**
 * 送付先・連絡先の更新（p0_26）。種別ごとに対応する Prisma モデルへ反映する。
 * org スコープ内のレコードのみ対象とし、更新前後の値を返して監査記録に利用する。
 */
export async function updateContactProfile(
  tx: DbClient,
  orgId: string,
  kind: ContactProfileKind,
  id: string,
  input: ContactProfileUpdateInput
): Promise<{ before: Record<string, unknown>; after: Record<string, unknown> } | null> {
  const has = <K extends keyof ContactProfileUpdateInput>(key: K) =>
    Object.prototype.hasOwnProperty.call(input, key);
  const trimmedName = input.name?.trim();

  if (kind === 'facility_contact') {
    const existing = await tx.facilityContact.findFirst({
      where: { id, org_id: orgId },
    });
    if (!existing) return null;
    const data = {
      ...(trimmedName ? { name: trimmedName } : {}),
      ...(has('role') ? { role: input.role || null } : {}),
      ...(has('phone') ? { phone: input.phone || null } : {}),
      ...(has('email') ? { email: input.email || null } : {}),
      ...(has('fax') ? { fax: input.fax || null } : {}),
      ...(has('preferred_contact_method')
        ? { preferred_contact_method: input.preferred_contact_method ?? null }
        : {}),
      ...(has('preferred_contact_time')
        ? { preferred_contact_time: input.preferred_contact_time || null }
        : {}),
    };
    const after = await tx.facilityContact.update({ where: { id }, data });
    return { before: existing, after };
  }

  if (kind === 'external_professional') {
    const existing = await tx.externalProfessional.findFirst({
      where: { id, org_id: orgId },
    });
    if (!existing) return null;
    const data = {
      ...(trimmedName ? { name: trimmedName } : {}),
      ...(has('department') ? { department: input.department || null } : {}),
      ...(has('phone') ? { phone: input.phone || null } : {}),
      ...(has('email') ? { email: input.email || null } : {}),
      ...(has('fax') ? { fax: input.fax || null } : {}),
      ...(has('preferred_contact_method')
        ? { preferred_contact_method: input.preferred_contact_method ?? null }
        : {}),
      ...(has('preferred_contact_time')
        ? { preferred_contact_time: input.preferred_contact_time || null }
        : {}),
    };
    const after = await tx.externalProfessional.update({ where: { id }, data });
    return { before: existing, after };
  }

  const existing = await tx.prescriberInstitution.findFirst({
    where: { id, org_id: orgId },
  });
  if (!existing) return null;
  const data = {
    ...(trimmedName ? { name: trimmedName } : {}),
    ...(has('phone') ? { phone: input.phone || null } : {}),
    ...(has('fax') ? { fax: input.fax || null } : {}),
    ...(has('preferred_contact_method')
      ? { preferred_contact_method: input.preferred_contact_method ?? null }
      : {}),
    ...(has('preferred_contact_time')
      ? { preferred_contact_time: input.preferred_contact_time || null }
      : {}),
  };
  const after = await tx.prescriberInstitution.update({ where: { id }, data });
  return { before: existing, after };
}
