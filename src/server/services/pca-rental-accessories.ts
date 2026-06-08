import type { Prisma } from '@prisma/client';
import { pcaPumpAccessoryChecklistItems } from '@/lib/validations/pca-pump-rental';

type AccessoryChecklistStatus = 'ok' | 'missing' | 'damaged' | 'not_applicable';
type AccessoryChecklist = Partial<
  Record<
    (typeof pcaPumpAccessoryChecklistItems)[number]['key'],
    { status: AccessoryChecklistStatus; notes?: string | null }
  >
>;

export type PcaRentalAccessoryTx = {
  pcaPumpRentalAccessory: {
    createMany(args: { data: Prisma.PcaPumpRentalAccessoryCreateManyInput[] }): Promise<unknown>;
    upsert(args: Prisma.PcaPumpRentalAccessoryUpsertArgs): Promise<unknown>;
  };
};

export function buildDefaultPcaRentalAccessoryRows(args: {
  orgId: string;
  rentalId: string;
}): Prisma.PcaPumpRentalAccessoryCreateManyInput[] {
  return pcaPumpAccessoryChecklistItems.map((item) => ({
    org_id: args.orgId,
    rental_id: args.rentalId,
    accessory_key: item.key,
    name: item.label,
    expected_quantity: 1,
    checked_out_quantity: 1,
    returned_quantity: null,
    checkout_condition: 'ok',
    return_condition: null,
    discrepancy_status: 'unchecked',
    billable: false,
    charge_amount_yen: null,
    notes: null,
  }));
}

function returnedQuantityForStatus(status: AccessoryChecklistStatus) {
  return status === 'ok' ? 1 : 0;
}

function discrepancyStatusForStatus(status: AccessoryChecklistStatus) {
  if (status === 'ok') return 'none';
  return status;
}

export async function createDefaultPcaRentalAccessories(
  tx: PcaRentalAccessoryTx,
  args: { orgId: string; rentalId: string },
) {
  return tx.pcaPumpRentalAccessory.createMany({
    data: buildDefaultPcaRentalAccessoryRows(args),
  });
}

export async function syncPcaRentalAccessoriesFromReturnInspection(
  tx: PcaRentalAccessoryTx,
  args: { orgId: string; rentalId: string; checklist: AccessoryChecklist },
) {
  await Promise.all(
    pcaPumpAccessoryChecklistItems.map((item) => {
      const checked = args.checklist[item.key];
      if (!checked) return null;
      const status = checked.status;
      const update = {
        name: item.label,
        returned_quantity: returnedQuantityForStatus(status),
        return_condition: status,
        discrepancy_status: discrepancyStatusForStatus(status),
        billable: false,
        charge_amount_yen: null,
        notes: checked.notes?.trim() || null,
      };
      return tx.pcaPumpRentalAccessory.upsert({
        where: {
          org_id_rental_id_accessory_key: {
            org_id: args.orgId,
            rental_id: args.rentalId,
            accessory_key: item.key,
          },
        },
        create: {
          org_id: args.orgId,
          rental_id: args.rentalId,
          accessory_key: item.key,
          expected_quantity: 1,
          checked_out_quantity: 1,
          checkout_condition: 'ok',
          ...update,
        },
        update,
      });
    }),
  );
}
