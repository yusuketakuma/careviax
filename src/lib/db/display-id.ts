import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

import {
  DISPLAY_ID_GLOBAL_ORG_ID,
  getDisplayIdModelForPrefix,
  getDisplayIdRegistryEntry,
  isDisplayIdModel,
  isReservedDisplayIdPrefix,
  type DisplayIdModel,
  type DisplayIdPrefix,
} from './display-id-registry';

export {
  DISPLAY_ID_EXCLUDED_MODELS,
  DISPLAY_ID_GLOBAL_ORG_ID,
  DISPLAY_ID_INFRASTRUCTURE_MODELS,
  DISPLAY_ID_REGISTRY,
  RESERVED_DISPLAY_ID_PREFIXES,
  getDisplayIdModelForPrefix,
  getDisplayIdRegistryEntry,
  isDisplayIdModel,
} from './display-id-registry';
export type {
  DisplayIdExcludedModel,
  DisplayIdInfrastructureModel,
  DisplayIdModel,
  DisplayIdPrefix,
  DisplayIdScope,
} from './display-id-registry';

export const DISPLAY_ID_PATTERN = /^[a-z]{1,6}[0-9]{10,15}$/;
const DISPLAY_ID_CAPTURE_PATTERN = /^([a-z]{1,6})([0-9]{10,15})$/;
const DISPLAY_ID_PREFIX_PATTERN = /^[a-z]{1,6}$/;
const DISPLAY_ID_ORG_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_DISPLAY_ID_SEQUENCE_DIGITS = 15;

type DisplayIdSqlExecutor = Pick<Prisma.TransactionClient, '$queryRaw'>;
type DisplayIdGlobalSqlExecutor = Pick<PrismaClient, '$queryRaw'>;

interface DisplayIdAllocationRow {
  readonly first_value: bigint | number | string;
}

export interface ParsedDisplayId {
  readonly raw: string;
  readonly model: DisplayIdModel;
  readonly prefix: DisplayIdPrefix;
  readonly sequence: bigint;
}

export const displayIdSchema = z
  .string()
  .regex(DISPLAY_ID_PATTERN)
  .refine((value) => parseDisplayId(value) !== null, {
    message: 'Unknown display ID prefix',
  });

function assertDisplayIdModel(model: string): asserts model is DisplayIdModel {
  if (!isDisplayIdModel(model)) {
    throw new Error(`Unknown display_id model: ${model}`);
  }
}

function assertTenantOrgId(orgId: string): void {
  if (orgId === DISPLAY_ID_GLOBAL_ORG_ID) {
    throw new Error('Tenant display_id allocation must not use the global sentinel orgId');
  }
  if (!DISPLAY_ID_ORG_ID_PATTERN.test(orgId)) {
    throw new Error('Tenant display_id allocation requires a non-empty safe orgId');
  }
}

function assertAssignablePrefix(prefix: string): asserts prefix is DisplayIdPrefix {
  if (!DISPLAY_ID_PREFIX_PATTERN.test(prefix)) {
    throw new Error(`Invalid display_id prefix: ${prefix}`);
  }
  if (isReservedDisplayIdPrefix(prefix)) {
    throw new Error(`Reserved display_id prefix is not assignable: ${prefix}`);
  }
  if (!getDisplayIdModelForPrefix(prefix)) {
    throw new Error(`Unknown display_id prefix: ${prefix}`);
  }
}

function normalizeSequence(value: bigint | number | string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error('display_id sequence number must be a safe integer');
    }
    return BigInt(value);
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new Error('display_id sequence string must contain digits only');
  }
  return BigInt(value);
}

function assertSequenceInDisplayIdDomain(sequence: bigint): void {
  if (sequence <= BigInt(0)) {
    throw new Error('display_id sequence must be positive');
  }
  if (sequence.toString().length > MAX_DISPLAY_ID_SEQUENCE_DIGITS) {
    throw new Error('display_id sequence exceeds 15 digits');
  }
}

function formatDisplayIdFromPrefix(
  prefix: string,
  sequenceValue: bigint | number | string,
): string {
  assertAssignablePrefix(prefix);
  const sequence = normalizeSequence(sequenceValue);
  assertSequenceInDisplayIdDomain(sequence);
  return `${prefix}${sequence.toString().padStart(10, '0')}`;
}

export function formatDisplayId(
  model: DisplayIdModel,
  sequenceValue: bigint | number | string,
): string {
  assertDisplayIdModel(model);
  return formatDisplayIdFromPrefix(getDisplayIdRegistryEntry(model).prefix, sequenceValue);
}

export function parseDisplayId(value: string): ParsedDisplayId | null {
  const match = DISPLAY_ID_CAPTURE_PATTERN.exec(value);
  if (!match) return null;

  const [, prefix, sequenceText] = match;
  if (!prefix || !sequenceText) return null;
  if (isReservedDisplayIdPrefix(prefix)) return null;

  const model = getDisplayIdModelForPrefix(prefix);
  if (!model) return null;

  const sequence = BigInt(sequenceText);
  if (sequence <= BigInt(0)) return null;
  return { raw: value, model, prefix: prefix as DisplayIdPrefix, sequence };
}

function requireTenantScopedEntry(model: DisplayIdModel) {
  assertDisplayIdModel(model);
  const entry = getDisplayIdRegistryEntry(model);
  if (entry.scope === 'global') {
    throw new Error(`Model ${model} requires allocateGlobalDisplayId`);
  }
  return entry;
}

function requireGlobalScopedEntry(model: DisplayIdModel) {
  assertDisplayIdModel(model);
  const entry = getDisplayIdRegistryEntry(model);
  if (entry.scope !== 'global') {
    throw new Error(`Model ${model} requires tenant-scoped allocateDisplayId`);
  }
  return entry;
}

async function allocateDisplayIdRangeByPrefix(
  executor: DisplayIdSqlExecutor,
  orgId: string,
  prefix: DisplayIdPrefix,
  amount: number,
): Promise<bigint[]> {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('display_id allocation amount must be a positive safe integer');
  }

  const amountBigInt = BigInt(amount);
  const rows = await executor.$queryRaw<DisplayIdAllocationRow[]>`
    INSERT INTO id_sequence (org_id, prefix, next_value, updated_at)
    VALUES (${orgId}, ${prefix}, ${amountBigInt + BigInt(1)}, CURRENT_TIMESTAMP)
    ON CONFLICT (org_id, prefix)
    DO UPDATE SET
      next_value = id_sequence.next_value + ${amountBigInt},
      updated_at = CURRENT_TIMESTAMP
    RETURNING next_value - ${amountBigInt} AS first_value
  `;

  const firstValue = rows[0]?.first_value;
  if (firstValue === undefined) {
    throw new Error('display_id allocation did not return a sequence value');
  }

  const first = normalizeSequence(firstValue);
  return Array.from({ length: amount }, (_, index) => first + BigInt(index));
}

export async function allocateDisplayId(
  tx: Prisma.TransactionClient,
  model: DisplayIdModel,
  orgId: string,
): Promise<string> {
  const ids = await allocateDisplayIdRange(tx, model, orgId, 1);
  const id = ids[0];
  if (!id) throw new Error('display_id allocation returned an empty range');
  return id;
}

export async function allocateDisplayIdRange(
  tx: Prisma.TransactionClient,
  model: DisplayIdModel,
  orgId: string,
  amount: number,
): Promise<string[]> {
  assertTenantOrgId(orgId);
  const entry = requireTenantScopedEntry(model);
  const sequences = await allocateDisplayIdRangeByPrefix(tx, orgId, entry.prefix, amount);
  return sequences.map((sequence) => formatDisplayIdFromPrefix(entry.prefix, sequence));
}

export async function allocateGlobalDisplayId(
  client: DisplayIdGlobalSqlExecutor,
  model: DisplayIdModel,
): Promise<string> {
  const entry = requireGlobalScopedEntry(model);
  const sequences = await allocateDisplayIdRangeByPrefix(
    client,
    DISPLAY_ID_GLOBAL_ORG_ID,
    entry.prefix,
    1,
  );
  const sequence = sequences[0];
  if (sequence === undefined) {
    throw new Error('global display_id allocation returned an empty range');
  }
  return formatDisplayIdFromPrefix(entry.prefix, sequence);
}
