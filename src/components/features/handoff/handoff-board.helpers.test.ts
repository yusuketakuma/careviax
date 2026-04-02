import { describe, expect, it } from 'vitest';
import { resolveHandoffEntityAction } from './handoff-board.helpers';

describe('resolveHandoffEntityAction', () => {
  it('maps supported entity types to workflow destinations', () => {
    expect(
      resolveHandoffEntityAction({
        entity_type: 'visit_record',
        entity_id: 'visit_record_1',
      })
    ).toEqual({
      href: '/visits/handoffs/visit_record_1',
      label: '申し送りを確認',
    });

    expect(
      resolveHandoffEntityAction({
        entity_type: 'patient',
        entity_id: 'patient_1',
      })
    ).toEqual({
      href: '/patients/patient_1',
      label: '患者を開く',
    });
  });

  it('returns null when the entity is absent or unsupported', () => {
    expect(
      resolveHandoffEntityAction({
        entity_type: null,
        entity_id: 'visit_record_1',
      })
    ).toEqual(null);

    expect(
      resolveHandoffEntityAction({
        entity_type: 'unknown_entity',
        entity_id: 'entity_1',
      })
    ).toEqual(null);
  });
});
