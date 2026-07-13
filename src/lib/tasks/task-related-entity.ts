import { getTaskTypeDefinition } from '@/lib/tasks/task-registry';

type TaskRelatedEntityField = 'related_entity_type' | 'related_entity_id';

export type TaskRelatedEntityContractEvaluation =
  | {
      valid: true;
      reason: 'not_provided' | 'allowed';
      canonicalTaskType: string;
    }
  | {
      valid: false;
      reason:
        | 'unregistered_task_type'
        | 'incomplete_pair'
        | 'blank_related_entity_type'
        | 'blank_related_entity_id'
        | 'unsupported_related_entity_type';
      canonicalTaskType: string | null;
      field: TaskRelatedEntityField;
    };

/**
 * A task may be context-free, but a provided related entity must be a complete
 * type/id pair whose type is registered for both canonical and legacy aliases.
 */
export function evaluateTaskRelatedEntityContract(args: {
  taskType: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
}): TaskRelatedEntityContractEvaluation {
  const definition = getTaskTypeDefinition(args.taskType);
  if (!definition) {
    return {
      valid: false,
      reason: 'unregistered_task_type',
      canonicalTaskType: null,
      field: 'related_entity_type',
    };
  }

  const relatedEntityType = args.relatedEntityType ?? null;
  const relatedEntityId = args.relatedEntityId ?? null;

  if (relatedEntityType === null && relatedEntityId === null) {
    return {
      valid: true,
      reason: 'not_provided',
      canonicalTaskType: definition.taskType,
    };
  }

  if (relatedEntityType === null || relatedEntityId === null) {
    return {
      valid: false,
      reason: 'incomplete_pair',
      canonicalTaskType: definition.taskType,
      field: relatedEntityType === null ? 'related_entity_type' : 'related_entity_id',
    };
  }

  if (relatedEntityType.trim().length === 0) {
    return {
      valid: false,
      reason: 'blank_related_entity_type',
      canonicalTaskType: definition.taskType,
      field: 'related_entity_type',
    };
  }
  if (relatedEntityId.trim().length === 0) {
    return {
      valid: false,
      reason: 'blank_related_entity_id',
      canonicalTaskType: definition.taskType,
      field: 'related_entity_id',
    };
  }

  if (!definition.allowedRelatedEntityTypes.includes(relatedEntityType)) {
    return {
      valid: false,
      reason: 'unsupported_related_entity_type',
      canonicalTaskType: definition.taskType,
      field: 'related_entity_type',
    };
  }

  return {
    valid: true,
    reason: 'allowed',
    canonicalTaskType: definition.taskType,
  };
}
