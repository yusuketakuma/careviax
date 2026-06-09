import { describe, expect, it } from 'vitest';
import { rethrowDynamoTransactionConflict } from './dynamodb-transaction-errors';

describe('DynamoDB transaction error mapping', () => {
  it('maps conditional transaction cancellation to a deterministic stale-version conflict', () => {
    const error = {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed', Message: 'stale' }],
    };

    expect(() => rethrowDynamoTransactionConflict(error, { resource: 'visit_step' })).toThrowError(
      expect.objectContaining({
        status: 409,
        error_code: 'STALE_VERSION',
        details: {
          reason: 'dynamo_transaction_conflict',
          resource: 'visit_step',
        },
      }),
    );
  });

  it('rethrows non-transaction errors unchanged', () => {
    const error = new Error('network unavailable');

    expect(() => rethrowDynamoTransactionConflict(error)).toThrow(error);
  });
});
