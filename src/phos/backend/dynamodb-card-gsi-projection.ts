import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { CardSummaryView } from '@/phos/contracts/phos_contracts';
import { assigneeStatusDueGsiSk, boardGsiSk } from './dynamodb-keys';

export type DynamoCardGsiProjectionUpdate = {
  set: Record<string, AttributeValue>;
  remove: string[];
};

export function buildDynamoCardGsiProjectionUpdate(input: {
  tenant_partition_key: string;
  card: Pick<CardSummaryView, 'card_id' | 'current_step' | 'display_status' | 'due_at'>;
}): DynamoCardGsiProjectionUpdate {
  const board_gsi_pk = `${input.tenant_partition_key}#BOARD`;
  if (!input.card.due_at) {
    return {
      set: {
        GSI1PK: { S: board_gsi_pk },
      },
      remove: ['GSI1SK', 'GSI2SK'],
    };
  }

  return {
    set: {
      GSI1PK: { S: board_gsi_pk },
      GSI1SK: {
        S: boardGsiSk({
          current_step: input.card.current_step,
          due_at: input.card.due_at,
          card_id: input.card.card_id,
        }),
      },
      GSI2SK: {
        S: assigneeStatusDueGsiSk({
          display_status: input.card.display_status,
          due_at: input.card.due_at,
          card_id: input.card.card_id,
        }),
      },
    },
    remove: [],
  };
}
