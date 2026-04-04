export const PATIENT_MCS_SOURCE_URL_MESSAGE =
  'MCS の患者 URL または医療・介護側タイムライン URL を入力してください';

export const ALLOWED_MCS_HOSTS = new Set(['www.medical-care.net', 'medical-care.net']);

function isSupportedMedicalCareStationPath(pathname: string) {
  return (
    /^\/patients\/[^/]+\/?$/.test(pathname) ||
    /^\/projects\/medical\/[^/]+\/?$/.test(pathname) ||
    /^\/projects\/unavailable\/[^/]+\/patient\/?$/.test(pathname)
  );
}

export function parseMedicalCareStationUrl(url: string | null) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !ALLOWED_MCS_HOSTS.has(parsed.hostname)) {
      return null;
    }
    if (!isSupportedMedicalCareStationPath(parsed.pathname)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function resolvePatientMcsSourceValidationError(draftSourceUrl: string) {
  const normalizedDraft = draftSourceUrl.trim();
  if (normalizedDraft.length === 0) {
    return null;
  }

  return parseMedicalCareStationUrl(normalizedDraft) ? null : PATIENT_MCS_SOURCE_URL_MESSAGE;
}

export function resolvePatientMcsSyncSource(draftSourceUrl: string, savedSourceUrl: string | null) {
  const normalizedDraft = draftSourceUrl.trim();
  if (normalizedDraft.length > 0) {
    return parseMedicalCareStationUrl(normalizedDraft)?.toString() ?? null;
  }

  return parseMedicalCareStationUrl(savedSourceUrl?.trim() ?? '')?.toString() ?? null;
}

type PatientMcsLinkSourceLike = {
  sourceUrl: string | null;
  projectUrl: string | null;
  patientUrl: string | null;
};

export function resolvePatientMcsOpenTargets(
  link: PatientMcsLinkSourceLike | null,
  draftSourceUrl?: string | null
) {
  const sourceUrl = resolvePatientMcsSyncSource(draftSourceUrl ?? '', link?.sourceUrl ?? null);
  const projectUrl = link?.projectUrl?.trim() || null;
  const patientUrl = link?.patientUrl?.trim() || null;
  const parsedSourceUrl = parseMedicalCareStationUrl(sourceUrl);

  return {
    mcsUrl: projectUrl ?? sourceUrl,
    patientUrl:
      patientUrl ??
      (parsedSourceUrl?.pathname.startsWith('/patients/') ? parsedSourceUrl.toString() : null),
  };
}
