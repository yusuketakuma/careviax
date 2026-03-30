import type { CommunicationChannel, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

type DbClient = Prisma.TransactionClient | typeof prisma;

type ExternalProfessionalSuggestion = {
  id: string;
  name: string;
  profession_type: string;
  organization_name: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  preferred_contact_method: CommunicationChannel | null;
  preferred_contact_time: string | null;
  last_contacted_at: Date | null;
  last_success_channel: CommunicationChannel | null;
  recommended_channels: CommunicationChannel[];
  is_primary: boolean;
};

type ContactProfileRow = {
  id: string;
  kind: 'facility_contact' | 'external_professional' | 'prescriber_institution';
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
  if (input.preferred) {
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
) {
  const uniqueNames = Array.from(
    new Set(names.map((name) => name.trim()).filter((name) => name.length > 0))
  );
  const statsMap = new Map<string, ChannelStats>();
  if (uniqueNames.length === 0) return statsMap;

  const [deliveries, events] = await Promise.all([
    db.deliveryRecord.findMany({
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
    db.communicationEvent.findMany({
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
): Promise<ExternalProfessionalSuggestion[]> {
  if (!input.patientId && !input.caseId) return [];

  const cases = await db.careCase.findMany({
    where: {
      org_id: orgId,
      ...(input.caseId ? { id: input.caseId } : {}),
      ...(input.patientId ? { patient_id: input.patientId } : {}),
    },
    select: {
      id: true,
      care_team_links: {
        where: {
          external_professional_id: {
            not: null,
          },
        },
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        select: {
          is_primary: true,
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
      if (!professional || !link.external_professional_id) continue;
      if (deduped.has(professional.id)) continue;
      deduped.set(professional.id, {
        id: professional.id,
        name: professional.name,
        profession_type: professional.profession_type,
        organization_name: professional.organization_name,
        department: professional.department,
        phone: professional.phone,
        email: professional.email,
        fax: professional.fax,
        preferred_contact_method: professional.preferred_contact_method,
        preferred_contact_time: professional.preferred_contact_time,
        last_contacted_at: professional.last_contacted_at,
        last_success_channel: professional.last_success_channel,
        recommended_channels: [],
        is_primary: link.is_primary,
      });
    }
  }

  const channelStatsByName = await getChannelStatsByName(
    db,
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
        address: null,
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
