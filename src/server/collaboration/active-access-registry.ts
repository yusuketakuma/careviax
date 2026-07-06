import type { PrismaClient } from '@prisma/client';
import type { AuthContext } from '@/lib/auth/context';
import {
  createCollaborationAccessRegistry,
  type CollaborationAccessProvider,
} from '@/core/collaboration/registry';
import { createPharmacyCollaborationAccessProviders } from '@/modules/pharmacy';
import { createCoreCollaborationAccessProviders } from './core-access-providers';

export const ACTIVE_COLLABORATION_ENTITY_TYPES = [
  'patient',
  'visit_record',
  'care_report',
  'dispense_task',
  'medication_cycle',
  'set_plan',
] as const;

export type ActiveCollaborationEntityType = (typeof ACTIVE_COLLABORATION_ENTITY_TYPES)[number];

const activeCollaborationAccessProviders = [
  ...createCoreCollaborationAccessProviders(),
  ...createPharmacyCollaborationAccessProviders(),
] as const satisfies readonly CollaborationAccessProvider<
  AuthContext,
  PrismaClient,
  ActiveCollaborationEntityType
>[];

export const activeCollaborationAccessRegistry = createCollaborationAccessRegistry(
  activeCollaborationAccessProviders,
);
