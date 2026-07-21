import type { CommunicationChannel, Prisma } from '@prisma/client';
import type { prisma } from '@/lib/db/client';
import type { ContactProfileKind } from './contact-profile-options';

export type DbClient = Prisma.TransactionClient | typeof prisma;

export type ChannelStatsDbClient = {
  deliveryRecord: {
    groupBy(args: unknown): Promise<
      Array<{
        recipient_name: string;
        channel: CommunicationChannel;
        status: string;
        _count: { _all: number };
      }>
    >;
  };
  communicationEvent: {
    groupBy(args: unknown): Promise<
      Array<{
        counterpart_name: string | null;
        channel: CommunicationChannel;
        event_type: string;
        _count: { _all: number };
      }>
    >;
  };
};

export type ExternalProfessionalSuggestionsDbClient = ChannelStatsDbClient & {
  careCase: {
    findMany(args: unknown): Promise<
      Array<{
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
      }>
    >;
  };
};

export type ExternalProfessionalSuggestion = {
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
  contact_reliability: ContactProfileReliability;
  is_primary: boolean;
  source: 'patient_care_team' | 'external_professional_master';
};

export type ContactProfileRow = {
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
  contact_reliability: ContactProfileReliability;
  active_patient_count: number;
  pending_response_count: number;
};

export type ContactProfileSearchSummary = {
  id: string;
  kind: ContactProfileKind;
  name: string;
  subtitle: string | null;
  last_contacted_at: Date | null;
};

export type ContactProfileReliability = {
  ready: boolean;
  warnings: string[];
  missing_channel_labels: string[];
};

export type ChannelStats = Record<
  CommunicationChannel,
  {
    success: number;
    failure: number;
  }
>;
