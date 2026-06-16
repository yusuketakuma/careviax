import { describe, expect, it } from 'vitest';
import {
  parseMedicalCareStationUrl,
  resolvePatientMcsOpenTargets,
  resolvePatientMcsSourceValidationError,
  resolvePatientMcsSyncSource,
} from './source';

describe('resolvePatientMcsSyncSource', () => {
  it('prefers a trimmed draft URL over the saved URL', () => {
    expect(
      resolvePatientMcsSyncSource(
        ' https://www.medical-care.net/patients/2463520 ',
        'https://www.medical-care.net/patients/1111111',
      ),
    ).toBe('https://www.medical-care.net/patients/2463520');
  });

  it('falls back to the saved URL and returns null when neither exists', () => {
    expect(resolvePatientMcsSyncSource('', 'https://www.medical-care.net/patients/1111111')).toBe(
      'https://www.medical-care.net/patients/1111111',
    );
    expect(resolvePatientMcsSyncSource('   ', null)).toBeNull();
  });

  it('derives open targets from saved source settings before a sync completes', () => {
    expect(
      resolvePatientMcsOpenTargets({
        sourceUrl: 'https://www.medical-care.net/patients/2463520',
        projectUrl: null,
        patientUrl: null,
      }),
    ).toEqual({
      mcsUrl: 'https://www.medical-care.net/patients/2463520',
      patientUrl: 'https://www.medical-care.net/patients/2463520',
    });

    expect(
      resolvePatientMcsOpenTargets({
        sourceUrl: 'https://www.medical-care.net/projects/medical/57886227',
        projectUrl: null,
        patientUrl: null,
      }),
    ).toEqual({
      mcsUrl: 'https://www.medical-care.net/projects/medical/57886227',
      patientUrl: null,
    });
  });

  it('prefers the draft URL when resolving open targets from the settings form', () => {
    expect(
      resolvePatientMcsOpenTargets(
        {
          sourceUrl: 'https://www.medical-care.net/projects/medical/57886227',
          projectUrl: null,
          patientUrl: null,
        },
        ' https://www.medical-care.net/patients/2463520 ',
      ),
    ).toEqual({
      mcsUrl: 'https://www.medical-care.net/patients/2463520',
      patientUrl: 'https://www.medical-care.net/patients/2463520',
    });
  });

  it('rejects unsupported and relative draft URLs for sync and open targets', () => {
    expect(resolvePatientMcsSourceValidationError('invalid-url')).toBe(
      'MCS の患者 URL または医療・介護側タイムライン URL を入力してください',
    );
    expect(
      resolvePatientMcsSyncSource('invalid-url', 'https://www.medical-care.net/patients/1111111'),
    ).toBeNull();
    expect(
      resolvePatientMcsOpenTargets(
        {
          sourceUrl: 'https://www.medical-care.net/patients/1111111',
          projectUrl: null,
          patientUrl: null,
        },
        'invalid-url',
      ),
    ).toEqual({
      mcsUrl: null,
      patientUrl: null,
    });
  });

  it('revalidates saved project and patient URLs before exposing open targets', () => {
    expect(
      resolvePatientMcsOpenTargets({
        sourceUrl: 'https://www.medical-care.net/patients/1111111',
        projectUrl: 'http://www.medical-care.net/projects/medical/57886227',
        patientUrl: 'https://example.com/patients/1111111',
      }),
    ).toEqual({
      mcsUrl: 'https://www.medical-care.net/patients/1111111',
      patientUrl: 'https://www.medical-care.net/patients/1111111',
    });
  });

  it('parses only supported medical care station urls', () => {
    expect(
      parseMedicalCareStationUrl('https://www.medical-care.net/patients/2463520')?.toString(),
    ).toBe('https://www.medical-care.net/patients/2463520');
    expect(parseMedicalCareStationUrl('http://www.medical-care.net/patients/2463520')).toBeNull();
    expect(parseMedicalCareStationUrl('https://example.com/patients/2463520')).toBeNull();
    expect(parseMedicalCareStationUrl('/patients/2463520')).toBeNull();
  });
});
