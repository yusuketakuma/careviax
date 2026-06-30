import {
  buildPatientOperationalSummary,
  type PatientOperationalSummary,
  type PatientOperationalSummaryInput,
} from '@/lib/patient/operational-summary';

type VisitSchedulePatientSummarySource = {
  case_: {
    patient?: Record<string, unknown> | null;
  };
};

function stripSummarySourceFields<T extends Record<string, unknown>>(patient: T) {
  const {
    archived_at: _archivedAt,
    allergy_info: _allergyInfo,
    insurances: _insurances,
    lab_observations: _labObservations,
    ...safePatient
  } = patient;
  void _archivedAt;
  void _allergyInfo;
  void _insurances;
  void _labObservations;
  return safePatient;
}

function isPatientOperationalSummaryInput(
  patient: Record<string, unknown>,
): patient is PatientOperationalSummaryInput & Record<string, unknown> {
  return typeof patient.id === 'string' && typeof patient.name === 'string';
}

export function attachVisitSchedulePatientSummary<T extends VisitSchedulePatientSummarySource>(
  schedule: T,
): T & { patient_summary: PatientOperationalSummary | null } {
  const patient = schedule.case_.patient;
  if (!patient) return { ...schedule, patient_summary: null };
  const safePatient = stripSummarySourceFields(patient);
  if (!isPatientOperationalSummaryInput(patient)) {
    return {
      ...schedule,
      case_: {
        ...schedule.case_,
        patient: safePatient,
      },
      patient_summary: null,
    };
  }

  return {
    ...schedule,
    case_: {
      ...schedule.case_,
      patient: safePatient,
    },
    patient_summary: buildPatientOperationalSummary(patient),
  };
}
