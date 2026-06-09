import { PhosDomainError } from './cards-repository';

type DynamoCancellationReason = {
  Code?: string;
  Message?: string;
};

function cancellationReasons(error: unknown): DynamoCancellationReason[] {
  if (!error || typeof error !== 'object') return [];
  const reasons = (error as { CancellationReasons?: unknown }).CancellationReasons;
  if (!Array.isArray(reasons)) return [];
  return reasons.filter((reason): reason is DynamoCancellationReason => {
    return !!reason && typeof reason === 'object';
  });
}

export function isDynamoTransactionConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  if (name !== 'TransactionCanceledException') return false;
  const reasons = cancellationReasons(error);
  return reasons.length === 0 || reasons.some((reason) => reason.Code === 'ConditionalCheckFailed');
}

export function rethrowDynamoTransactionConflict(
  error: unknown,
  details: Record<string, unknown> = {},
): never {
  if (isDynamoTransactionConflict(error)) {
    throw new PhosDomainError({
      status: 409,
      error_code: 'STALE_VERSION',
      message_key: 'api.error.stale_version',
      details: {
        reason: 'dynamo_transaction_conflict',
        ...details,
      },
    });
  }
  throw error;
}
