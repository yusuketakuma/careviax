export type PharmacistShiftWindow = {
  site_id: string;
  available: boolean;
  available_from: Date | null;
  available_to: Date | null;
};

export function timeStringToMinutes(value: string | undefined) {
  if (!value) return null;
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

export function timeDateToMinutes(value: Date | null) {
  if (!value) return null;
  return value.getHours() * 60 + value.getMinutes();
}

function validateScheduleWindowFitsShift(
  shift: PharmacistShiftWindow | null,
  scheduleStart: number | null,
  scheduleEnd: number | null,
) {
  if (!shift) return null;
  if (!shift.available) {
    return '選択した薬剤師は指定日のシフトが休みです';
  }
  if (scheduleStart == null || scheduleEnd == null) return null;

  const shiftStart = timeDateToMinutes(shift.available_from);
  const shiftEnd = timeDateToMinutes(shift.available_to);
  if (shiftStart != null && scheduleStart < shiftStart) {
    return '訪問開始時刻が薬剤師シフトの開始前です';
  }
  if (shiftEnd != null && scheduleEnd > shiftEnd) {
    return '訪問終了時刻が薬剤師シフトの終了後です';
  }

  return null;
}

export function validateScheduleTimeStringsFitShift(
  shift: PharmacistShiftWindow | null,
  timeWindowStart: string | undefined,
  timeWindowEnd: string | undefined,
) {
  const scheduleStart = timeStringToMinutes(timeWindowStart);
  const scheduleEnd = timeStringToMinutes(timeWindowEnd) ?? scheduleStart;
  return validateScheduleWindowFitsShift(shift, scheduleStart, scheduleEnd);
}

export function validateScheduleTimeDatesFitShift(
  shift: PharmacistShiftWindow | null,
  timeWindowStart: Date | null,
  timeWindowEnd: Date | null,
) {
  const scheduleStart = timeDateToMinutes(timeWindowStart);
  const scheduleEnd = timeDateToMinutes(timeWindowEnd) ?? scheduleStart;
  return validateScheduleWindowFitsShift(shift, scheduleStart, scheduleEnd);
}
