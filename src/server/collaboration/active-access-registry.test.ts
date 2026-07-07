import { describe, expect, it } from 'vitest';
import {
  ACTIVE_COLLABORATION_ENTITY_TYPES,
  activeCollaborationAccessRegistry,
} from './active-access-registry';

describe('activeCollaborationAccessRegistry', () => {
  it('keeps the active collaboration provider contract in core then pharmacy order', () => {
    expect(ACTIVE_COLLABORATION_ENTITY_TYPES).toEqual([
      'patient',
      'visit_record',
      'care_report',
      'dispense_task',
      'medication_cycle',
      'set_plan',
    ]);
    expect(activeCollaborationAccessRegistry.entityTypes()).toEqual(
      ACTIVE_COLLABORATION_ENTITY_TYPES,
    );
  });

  it('resolves every declared entity type and no unknown type', () => {
    for (const entityType of ACTIVE_COLLABORATION_ENTITY_TYPES) {
      expect(activeCollaborationAccessRegistry.get(entityType)).toMatchObject({ entityType });
    }

    expect(activeCollaborationAccessRegistry.get('nursing_record')).toBeNull();
  });
});
