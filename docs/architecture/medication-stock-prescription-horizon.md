# Medication Stock Prescription Horizon

Date: 2026-07-08
Scope: `STOCK-001-PRESCRIPTION-HORIZON`

## Decision

Use only structured `PrescriptionIntake` next-dispense dates as automatic
medication stock replenishment horizons, and only on the exact prescription
supply path that can already create a `MedicationStockEvent`.

Accepted automatic sources:

- `PrescriptionIntake.refill_next_dispense_date` when `source_type = refill`
- `PrescriptionIntake.split_next_dispense_date` when split dispensing is still
  incomplete

Both dates must be strictly after the forecast as-of Japan date. Same-day,
past, free-text, and request-only signals are not automatic horizons.

## Guardrails

- Apply the horizon only when the matched `PatientMedicationStockItem` has
  `source_type = prescription`.
- Keep DrugMaster identity, stock item cardinality, unit matching, and positive
  quantity checks from the existing prescription supply adapter.
- Do not use `MedicationCycle` alone. It has workflow status, but no next
  prescription date.
- Do not derive replenishment from `PrescriptionLine.days`, `start_date`,
  `end_date`, `DispenseResult.dispensed_at`, task metadata, or
  `refill_request`.
- Keep OTC, other-institution, unknown-source, ambiguous, package-only,
  name-only, and unit-conversion cases in review or horizon-unknown state.

## Forecast Semantics

The domain forecast keeps visit and replenishment horizons separate:

- stockout on or before a confirmed replenishment horizon maps to
  `shortage_expected`
- stockout after a confirmed replenishment horizon maps to `ok`, or `watch`
  when the forecast itself still requires review
- without a confirmed replenishment horizon, the existing next-visit and buffer
  behavior remains unchanged

This slice intentionally connects only the exact prescription supply path.
Visit observation and inbound recalculation callers remain on their existing
next-visit or buffer behavior until a later slice adds a safe exact-context
resolver for those call sites.

## Oracle Review

Oracle/GPT-5.5 Pro reviewed this decision on 2026-07-08 with GitHub context for
`https://github.com/yusuketakuma/careviax.git` at
`82215d6a369478b00fb1dc25a530caf0183a87bd`. It recommended the tightened
PrescriptionIntake-only approach above and rejected MedicationCycle-only,
line-days-derived, task/free-text, and `refill_request` sources for automatic
horizon creation.
