import { describe, expect, it } from 'vitest';
import { facilityPacketResponseSchema } from './facility-packet-response-schema';

function buildPayload() {
  return {
    data: {
      preparation: { provider_only: true },
      pack: {
        patient: { id: 'patient_1', birth_date: '1940-01-01' },
        facility_parallel_context: {
          batch_id: 'batch_1',
          label: '青空ホーム',
          place_kind: 'facility',
          site_name: '青空ホーム',
          common_notes: null,
          current_schedule_id: 'schedule_1',
          patients: [
            {
              schedule_id: 'schedule_1',
              patient_id: 'patient_1',
              patient_name: '山田 花子',
              patient_birth_date: '1940-01-01',
              unit_name: '101',
              route_order: 1,
              schedule_status: 'ready',
              preparation_blockers_count: 0,
              visit_record_id: null,
            },
          ],
        },
      },
    },
  };
}

describe('facilityPacketResponseSchema', () => {
  it('projects only the facility packet fields consumed by the screen', () => {
    const parsed = facilityPacketResponseSchema.parse(buildPayload());
    expect(parsed.data).not.toHaveProperty('preparation');
    expect(parsed.data.pack).not.toHaveProperty('patient');
    expect(parsed.data.pack.facility_parallel_context?.patients[0]).not.toHaveProperty(
      'patient_birth_date',
    );
    expect(parsed.data.pack.facility_parallel_context?.patients[0]).not.toHaveProperty(
      'patient_id',
    );
  });

  it.each([
    { pack: buildPayload().data.pack },
    { ...buildPayload(), debug: true },
    {
      data: {
        pack: {
          facility_parallel_context: {
            ...buildPayload().data.pack.facility_parallel_context,
            current_schedule_id: 'schedule_missing',
          },
        },
      },
    },
    {
      data: {
        pack: {
          facility_parallel_context: {
            ...buildPayload().data.pack.facility_parallel_context,
            patients: [
              buildPayload().data.pack.facility_parallel_context.patients[0],
              buildPayload().data.pack.facility_parallel_context.patients[0],
            ],
          },
        },
      },
    },
  ])('rejects malformed facility packet payload %#', (payload) => {
    expect(facilityPacketResponseSchema.safeParse(payload).success).toBe(false);
  });
});
