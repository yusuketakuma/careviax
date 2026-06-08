import { describe, expect, it, vi } from 'vitest';
import {
  buildDefaultPcaRentalAccessoryRows,
  createDefaultPcaRentalAccessories,
  syncPcaRentalAccessoriesFromReturnInspection,
} from './pca-rental-accessories';

describe('pca-rental-accessories service', () => {
  it('builds default accessory rows for a rental', () => {
    const rows = buildDefaultPcaRentalAccessoryRows({
      orgId: 'org_1',
      rentalId: 'rental_1',
    });

    expect(rows).toHaveLength(9);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          org_id: 'org_1',
          rental_id: 'rental_1',
          accessory_key: 'pump_body',
          name: 'ポンプ本体',
          expected_quantity: 1,
          checked_out_quantity: 1,
          discrepancy_status: 'unchecked',
        }),
      ]),
    );
  });

  it('creates default accessory rows through createMany', async () => {
    const tx = {
      pcaPumpRentalAccessory: {
        createMany: vi.fn().mockResolvedValue({ count: 9 }),
        upsert: vi.fn(),
      },
    };

    await createDefaultPcaRentalAccessories(tx, {
      orgId: 'org_1',
      rentalId: 'rental_1',
    });

    expect(tx.pcaPumpRentalAccessory.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          org_id: 'org_1',
          rental_id: 'rental_1',
          accessory_key: 'power_adapter',
        }),
      ]),
    });
  });

  it('upserts return inspection results into accessory rows', async () => {
    const tx = {
      pcaPumpRentalAccessory: {
        createMany: vi.fn(),
        upsert: vi.fn().mockResolvedValue({}),
      },
    };

    await syncPcaRentalAccessoriesFromReturnInspection(tx, {
      orgId: 'org_1',
      rentalId: 'rental_1',
      checklist: {
        pump_body: { status: 'ok' },
        power_adapter: { status: 'missing', notes: '医療機関で紛失' },
      },
    });

    expect(tx.pcaPumpRentalAccessory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id_rental_id_accessory_key: {
            org_id: 'org_1',
            rental_id: 'rental_1',
            accessory_key: 'pump_body',
          },
        },
        update: expect.objectContaining({
          return_condition: 'ok',
          discrepancy_status: 'none',
          returned_quantity: 1,
          billable: false,
        }),
      }),
    );
    expect(tx.pcaPumpRentalAccessory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id_rental_id_accessory_key: {
            org_id: 'org_1',
            rental_id: 'rental_1',
            accessory_key: 'power_adapter',
          },
        },
        update: expect.objectContaining({
          return_condition: 'missing',
          discrepancy_status: 'missing',
          returned_quantity: 0,
          billable: false,
          charge_amount_yen: null,
          notes: '医療機関で紛失',
        }),
      }),
    );
  });
});
