import {
  resolveOperatingState,
  timeStringToMinutes,
  type OperatingCalendar,
  type OperatingStateOpen,
} from '@/lib/calendar/operating-day';

/**
 * R4 boundary helper: pharmacy operating calendar and pharmacist shifts answer
 * different questions and must be composed explicitly.
 *
 * - PharmacyOperatingHours: weekly site-level operating default.
 * - BusinessHoliday: one-date site/org override for the pharmacy calendar.
 * - PharmacistShift: one pharmacist's availability on one date.
 * - PharmacistShiftTemplate: source material for future shift rows, not direct visit eligibility.
 *
 * Visit eligibility is the AND of pharmacy operating state and the selected
 * pharmacist shift/site/time window. This module stays pure and Date-free so
 * route/database adapters own @db.Time serialization.
 */

export type VisitAvailabilityShift = {
  site_id: string | null;
  available: boolean;
  available_from: string | null;
  available_to: string | null;
};

export type VisitTimeWindow = {
  from?: string | null;
  to?: string | null;
};

export type VisitAvailabilityBlockedReason =
  | 'pharmacy_holiday'
  | 'pharmacy_regular_closed'
  | 'invalid_pharmacy_operating_window'
  | 'outside_pharmacy_operating_window'
  | 'pharmacist_shift_missing'
  | 'pharmacist_shift_site_missing'
  | 'pharmacist_shift_site_mismatch'
  | 'pharmacist_unavailable'
  | 'invalid_pharmacist_shift_window'
  | 'invalid_visit_window'
  | 'outside_pharmacist_shift_window';

export type VisitAvailabilityAllowed = {
  canVisit: true;
  dateKey: string;
  siteId: string;
  operatingState: OperatingStateOpen;
};

export type VisitAvailabilityBlocked = {
  canVisit: false;
  dateKey: string;
  siteId: string;
  reason: VisitAvailabilityBlockedReason;
};

export type VisitAvailabilityDecision = VisitAvailabilityAllowed | VisitAvailabilityBlocked;

type ParsedWindow = {
  start: number | null;
  end: number | null;
};

function parseClockValue(value: string | null | undefined): number | null {
  return value == null || value === '' ? null : timeStringToMinutes(value);
}

function parseVisitWindow(window: VisitTimeWindow | null | undefined): ParsedWindow | 'invalid' {
  const from = window?.from ?? null;
  const to = window?.to ?? null;
  const start = parseClockValue(from);
  const endValue = parseClockValue(to);
  const fromPresent = from != null && from !== '';
  const toPresent = to != null && to !== '';

  if ((fromPresent && start == null) || (toPresent && endValue == null)) return 'invalid';

  const end = endValue ?? start;
  if (start != null && end != null && end < start) return 'invalid';
  return { start, end };
}

function parseBoundedWindow(
  from: string | null | undefined,
  to: string | null | undefined,
): ParsedWindow | 'invalid' {
  const start = parseClockValue(from);
  const end = parseClockValue(to);
  const fromPresent = from != null && from !== '';
  const toPresent = to != null && to !== '';

  if ((fromPresent && start == null) || (toPresent && end == null)) return 'invalid';
  if (start != null && end != null && end <= start) return 'invalid';
  return { start, end };
}

function outsideBoundaryWindow(visit: ParsedWindow, boundary: ParsedWindow): boolean {
  if (visit.start != null && boundary.start != null && visit.start < boundary.start) return true;
  if (visit.end != null && boundary.end != null && visit.end > boundary.end) return true;
  return false;
}

export function canVisitOn(args: {
  calendar: OperatingCalendar;
  dateKey: string;
  shift: VisitAvailabilityShift | null;
  visitWindow?: VisitTimeWindow | null;
}): VisitAvailabilityDecision {
  const { calendar, dateKey, shift, visitWindow } = args;
  const operatingState = resolveOperatingState(calendar, dateKey);

  if (!operatingState.open) {
    return {
      canVisit: false,
      dateKey,
      siteId: calendar.siteId,
      reason: operatingState.reason === 'holiday' ? 'pharmacy_holiday' : 'pharmacy_regular_closed',
    };
  }

  const pharmacyWindow = parseBoundedWindow(operatingState.from, operatingState.to);
  if (pharmacyWindow === 'invalid') {
    return {
      canVisit: false,
      dateKey,
      siteId: calendar.siteId,
      reason: 'invalid_pharmacy_operating_window',
    };
  }

  const parsedVisitWindow = parseVisitWindow(visitWindow);
  if (parsedVisitWindow === 'invalid') {
    return {
      canVisit: false,
      dateKey,
      siteId: calendar.siteId,
      reason: 'invalid_visit_window',
    };
  }

  if (outsideBoundaryWindow(parsedVisitWindow, pharmacyWindow)) {
    return {
      canVisit: false,
      dateKey,
      siteId: calendar.siteId,
      reason: 'outside_pharmacy_operating_window',
    };
  }

  if (!shift) {
    return {
      canVisit: false,
      dateKey,
      siteId: calendar.siteId,
      reason: 'pharmacist_shift_missing',
    };
  }

  if (!shift.site_id) {
    return {
      canVisit: false,
      dateKey,
      siteId: calendar.siteId,
      reason: 'pharmacist_shift_site_missing',
    };
  }

  if (shift.site_id !== calendar.siteId) {
    return {
      canVisit: false,
      dateKey,
      siteId: calendar.siteId,
      reason: 'pharmacist_shift_site_mismatch',
    };
  }

  if (!shift.available) {
    return {
      canVisit: false,
      dateKey,
      siteId: calendar.siteId,
      reason: 'pharmacist_unavailable',
    };
  }

  const shiftWindow = parseBoundedWindow(shift.available_from, shift.available_to);
  if (shiftWindow === 'invalid') {
    return {
      canVisit: false,
      dateKey,
      siteId: calendar.siteId,
      reason: 'invalid_pharmacist_shift_window',
    };
  }

  if (outsideBoundaryWindow(parsedVisitWindow, shiftWindow)) {
    return {
      canVisit: false,
      dateKey,
      siteId: calendar.siteId,
      reason: 'outside_pharmacist_shift_window',
    };
  }

  return {
    canVisit: true,
    dateKey,
    siteId: calendar.siteId,
    operatingState,
  };
}
