import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { CardSummaryView } from '@/phos/contracts/phos_contracts';
import {
  assigneeStatusDueGsiSk,
  boardGsiSk,
  packetGsiSk,
  patientTimelineGsiSk,
} from './dynamodb-keys';

export type DynamoCardGsiProjectionUpdate = {
  set: Record<string, AttributeValue>;
  remove: string[];
};

export function buildDynamoCardGsiProjectionUpdate(input: {
  tenant_partition_key: string;
  card: Pick<
    CardSummaryView,
    | 'card_id'
    | 'patient_id'
    | 'assigned_user_id'
    | 'packet_id'
    | 'current_step'
    | 'display_status'
    | 'created_at'
    | 'due_at'
  >;
}): DynamoCardGsiProjectionUpdate {
  const board_gsi_pk = `${input.tenant_partition_key}#BOARD`;
  const set: Record<string, AttributeValue> = {
    GSI1PK: { S: board_gsi_pk },
  };
  const remove: string[] = [];

  if (!input.card.due_at) {
    remove.push('GSI1SK', 'GSI2PK', 'GSI2SK');
  } else {
    set.GSI1SK = {
      S: boardGsiSk({
        current_step: input.card.current_step,
        due_at: input.card.due_at,
        card_id: input.card.card_id,
      }),
    };

    if (input.card.assigned_user_id) {
      set.GSI2PK = {
        S: `${input.tenant_partition_key}#ASSIGNEE#${input.card.assigned_user_id}`,
      };
      set.GSI2SK = {
        S: assigneeStatusDueGsiSk({
          display_status: input.card.display_status,
          due_at: input.card.due_at,
          card_id: input.card.card_id,
        }),
      };
    } else {
      remove.push('GSI2PK', 'GSI2SK');
    }
  }

  if (input.card.patient_id && input.card.created_at) {
    set.GSI3PK = {
      S: `${input.tenant_partition_key}#PATIENT#${input.card.patient_id}`,
    };
    set.GSI3SK = {
      S: patientTimelineGsiSk({
        created_at: input.card.created_at,
        card_id: input.card.card_id,
      }),
    };
  } else {
    remove.push('GSI3PK', 'GSI3SK');
  }

  if (input.card.packet_id) {
    set.GSI4PK = {
      S: `${input.tenant_partition_key}#PACKET#${input.card.packet_id}`,
    };
    set.GSI4SK = { S: packetGsiSk(input.card.card_id) };
  } else {
    remove.push('GSI4PK', 'GSI4SK');
  }

  return {
    set,
    remove,
  };
}
