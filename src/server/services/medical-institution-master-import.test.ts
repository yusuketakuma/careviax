import { describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  importMedicalInstitutionOpenData,
  parseMedicalInstitutionFacilityCsv,
  resolveLatestMedicalInstitutionFacilityUrls,
} from './medical-institution-master-import';

function csvFixture() {
  return [
    '\uFEFF"ID","正式名称","都道府県コード","所在地","電話番号","FAX番号"',
    '"1310112345678","丸の内在宅クリニック","13","東京都千代田区丸の内1-1-1","03-1234-5678","03-1234-5679"',
    '"1410112345678","横浜訪問診療所","14","神奈川県横浜市中区1-1","045-111-2222",""',
    '"","コードなし医院","13","東京都中央区1-1","03-0000-0000",""',
  ].join('\n');
}

function zipBuffer(filename: string, text: string) {
  return Buffer.from(zipSync({ [filename]: strToU8(text) }));
}

describe('medical institution master import', () => {
  it('resolves the latest hospital and clinic facility ZIP urls from MHLW open data HTML', () => {
    const urls = resolveLatestMedicalInstitutionFacilityUrls(
      `
        <a href="/content/11121000/01-1_hospital_facility_info_20250601.zip">old hospital</a>
        <a href="/content/11121000/02-1_clinic_facility_info_20250601.zip">old clinic</a>
        <a href="/content/11121000/01-1_hospital_facility_info_20251201.zip">hospital</a>
        <a href="/content/11121000/02-1_clinic_facility_info_20251201.zip">clinic</a>
      `,
    );

    expect(urls).toEqual([
      'https://www.mhlw.go.jp/content/11121000/01-1_hospital_facility_info_20251201.zip',
      'https://www.mhlw.go.jp/content/11121000/02-1_clinic_facility_info_20251201.zip',
    ]);
  });

  it('parses facility CSV rows and skips rows without official source id or name', () => {
    const records = parseMedicalInstitutionFacilityCsv(csvFixture(), 'clinic');

    expect(records).toEqual([
      {
        sourceCode: '1310112345678',
        sourceKind: 'clinic',
        name: '丸の内在宅クリニック',
        prefectureCode: '13',
        address: '東京都千代田区丸の内1-1-1',
        phone: '03-1234-5678',
        fax: '03-1234-5679',
      },
      {
        sourceCode: '1410112345678',
        sourceKind: 'clinic',
        name: '横浜訪問診療所',
        prefectureCode: '14',
        address: '神奈川県横浜市中区1-1',
        phone: '045-111-2222',
        fax: null,
      },
    ]);
  });

  it('updates existing org rows without overwriting local notes or contact preferences', async () => {
    const findManyOrganizations = vi.fn().mockResolvedValue([{ id: 'org_1' }]);
    const findManyInstitutions = vi.fn().mockResolvedValue([
      {
        id: 'inst_1',
        name: '旧名称クリニック',
        institution_code: '1310112345678',
        address: '旧住所',
        phone: null,
        fax: null,
      },
    ]);
    const updateInstitution = vi.fn().mockResolvedValue({});
    const createInstitution = vi.fn().mockResolvedValue({});
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('.zip')) {
        return new Response(
          new Blob([zipBuffer('02-1_clinic_facility_info_20251201.csv', csvFixture())]),
        );
      }
      throw new Error(`unexpected url ${url}`);
    }) as typeof fetch;

    const result = await importMedicalInstitutionOpenData(
      {
        organization: { findMany: findManyOrganizations },
        prescriberInstitution: {
          findMany: findManyInstitutions,
          update: updateInstitution,
          create: createInstitution,
        },
      },
      {
        sourceUrls: [
          'https://www.mhlw.go.jp/content/11121000/02-1_clinic_facility_info_20251201.zip',
        ],
        targetOrgIds: ['org_1'],
        fetchImpl,
      },
    );

    expect(result).toMatchObject({
      processedCount: 1,
      scannedCount: 2,
      matchedCount: 1,
      updatedCount: 1,
      createdCount: 0,
    });
    expect(updateInstitution).toHaveBeenCalledWith({
      where: { id: 'inst_1' },
      data: {
        name: '丸の内在宅クリニック',
        address: '東京都千代田区丸の内1-1-1',
        phone: '03-1234-5678',
        fax: '03-1234-5679',
      },
    });
    expect(JSON.stringify(updateInstitution.mock.calls[0][0].data)).not.toContain('notes');
    expect(createInstitution).not.toHaveBeenCalled();
  });

  it('creates new rows only for explicitly enabled prefecture codes', async () => {
    const findManyOrganizations = vi.fn().mockResolvedValue([{ id: 'org_1' }]);
    const findManyInstitutions = vi.fn().mockResolvedValue([]);
    const updateInstitution = vi.fn().mockResolvedValue({});
    const createInstitution = vi.fn().mockResolvedValue({});
    const fetchImpl = vi.fn(async () => {
      return new Response(
        new Blob([zipBuffer('02-1_clinic_facility_info_20251201.csv', csvFixture())]),
      );
    }) as typeof fetch;

    const result = await importMedicalInstitutionOpenData(
      {
        organization: { findMany: findManyOrganizations },
        prescriberInstitution: {
          findMany: findManyInstitutions,
          update: updateInstitution,
          create: createInstitution,
        },
      },
      {
        sourceUrls: [
          'https://www.mhlw.go.jp/content/11121000/02-1_clinic_facility_info_20251201.zip',
        ],
        autoCreatePrefectureCodes: ['13'],
        fetchImpl,
      },
    );

    expect(result).toMatchObject({
      processedCount: 1,
      scannedCount: 2,
      createdCount: 1,
      updatedCount: 0,
      autoCreatePrefectureCodes: ['13'],
    });
    expect(createInstitution).toHaveBeenCalledOnce();
    expect(createInstitution).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        name: '丸の内在宅クリニック',
        institution_code: '1310112345678',
        address: '東京都千代田区丸の内1-1-1',
        phone: '03-1234-5678',
        fax: '03-1234-5679',
        notes: 'MHLW medical open data auto-created (clinic)',
      },
    });
  });

  it('rejects non-official source URLs before fetch', async () => {
    const fetchImpl = vi.fn();

    await expect(
      importMedicalInstitutionOpenData(
        {
          organization: { findMany: vi.fn() },
          prescriberInstitution: {
            findMany: vi.fn(),
            update: vi.fn(),
            create: vi.fn(),
          },
        },
        {
          sourceUrls: ['https://example.com/clinic.zip'],
          fetchImpl: fetchImpl as typeof fetch,
        },
      ),
    ).rejects.toThrow('許可された公式取込ホストのみ指定できます');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
