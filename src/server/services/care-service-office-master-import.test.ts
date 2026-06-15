import { describe, expect, it, vi } from 'vitest';
import {
  CARE_SERVICE_DEFINITIONS,
  importCareServiceOfficeOpenData,
  parseCareServiceOfficeCsv,
  resolveLatestCareServiceOfficeCsvUrls,
} from './care-service-office-master-import';

const nursingDefinition = CARE_SERVICE_DEFINITIONS.find((item) => item.code === '130')!;
const careManagerDefinition = CARE_SERVICE_DEFINITIONS.find((item) => item.code === '430')!;

function csvFixture() {
  return [
    '\uFEFF都道府県コード又は市町村コード,No,都道府県名,市区町村名,事業所名,事業所名カナ,サービスの種類,住所,緯度,経度,URL,電話番号,FAX番号,法人番号,法人の名称,事業所番号',
    '13101,1,東京都,千代田区,丸の内訪問看護ステーション,マルノウチホウモンカンゴステーション,訪問看護,東京都千代田区丸の内1-1-1,0,0,,03-1234-5678,03-1234-5679,1234567890123,医療法人丸の内,1360199999',
    '14101,2,神奈川県,横浜市,横浜ケアプランセンター,ヨコハマケアプランセンター,居宅介護支援,神奈川県横浜市中区1-1,0,0,,045-111-2222,,1234567890124,株式会社横浜,1460199999',
    '13102,3,東京都,中央区,コードなし事業所,コードナシ,訪問看護,東京都中央区1-1,0,0,,03-0000-0000,,,法人,',
  ].join('\n');
}

describe('care service office master import', () => {
  it('resolves current MHLW CSV urls for all requested service codes', () => {
    const urls = resolveLatestCareServiceOfficeCsvUrls(
      `
        <a href="/content/12300000/jigyosho_130.csv">130_訪問看護</a>
        <a href="/content/12300000/jigyosho_430.csv">430_居宅介護支援</a>
      `,
      ['130', '430'],
    );

    expect(urls).toEqual([
      {
        code: '130',
        url: 'https://www.mhlw.go.jp/content/12300000/jigyosho_130.csv',
      },
      {
        code: '430',
        url: 'https://www.mhlw.go.jp/content/12300000/jigyosho_430.csv',
      },
    ]);
  });

  it('parses office CSV rows and skips rows without office number or name', () => {
    const records = parseCareServiceOfficeCsv(csvFixture(), nursingDefinition);

    expect(records).toEqual([
      {
        serviceCode: '130',
        serviceLabel: '訪問看護',
        officeCode: '1360199999',
        prefectureCode: '13',
        officeName: '丸の内訪問看護ステーション',
        corporationName: '医療法人丸の内',
        address: '東京都千代田区丸の内1-1-1',
        phone: '03-1234-5678',
        fax: '03-1234-5679',
        professionType: 'nurse',
      },
      {
        serviceCode: '130',
        serviceLabel: '居宅介護支援',
        officeCode: '1460199999',
        prefectureCode: '14',
        officeName: '横浜ケアプランセンター',
        corporationName: '株式会社横浜',
        address: '神奈川県横浜市中区1-1',
        phone: '045-111-2222',
        fax: null,
        professionType: 'nurse',
      },
    ]);
  });

  it('updates existing external professionals without overwriting local notes', async () => {
    const findManyOrganizations = vi.fn().mockResolvedValue([{ id: 'org_1' }]);
    const findManyProfessionals = vi.fn().mockResolvedValue([
      {
        id: 'external_1',
        profession_type: 'care_manager',
        name: '古い名称',
        organization_name: '古い事業所',
        phone: null,
        fax: null,
        address: '旧住所',
        notes: 'MHLW care service open data auto-created (mhlw-care-service:430:1360199999)',
      },
    ]);
    const updateProfessional = vi.fn().mockResolvedValue({});
    const createProfessional = vi.fn().mockResolvedValue({});
    const fetchImpl = vi.fn(async () => new Response(new Blob([csvFixture()]))) as typeof fetch;

    const result = await importCareServiceOfficeOpenData(
      {
        organization: { findMany: findManyOrganizations },
        externalProfessional: {
          findMany: findManyProfessionals,
          update: updateProfessional,
          create: createProfessional,
        },
      },
      {
        sourceUrls: ['https://www.mhlw.go.jp/content/12300000/jigyosho_430.csv'],
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
    expect(updateProfessional).toHaveBeenCalledWith({
      where: { id: 'external_1' },
      data: {
        name: '丸の内訪問看護ステーション（訪問看護）',
        organization_name: '丸の内訪問看護ステーション',
        address: '東京都千代田区丸の内1-1-1',
        phone: '03-1234-5678',
        fax: '03-1234-5679',
      },
    });
    expect(JSON.stringify(updateProfessional.mock.calls[0][0].data)).not.toContain('notes');
    expect(createProfessional).not.toHaveBeenCalled();
  });

  it('creates new rows only for explicitly enabled prefecture codes', async () => {
    const findManyOrganizations = vi.fn().mockResolvedValue([{ id: 'org_1' }]);
    const findManyProfessionals = vi.fn().mockResolvedValue([]);
    const updateProfessional = vi.fn().mockResolvedValue({});
    const createProfessional = vi.fn().mockResolvedValue({});
    const fetchImpl = vi.fn(async () => new Response(new Blob([csvFixture()]))) as typeof fetch;

    const result = await importCareServiceOfficeOpenData(
      {
        organization: { findMany: findManyOrganizations },
        externalProfessional: {
          findMany: findManyProfessionals,
          update: updateProfessional,
          create: createProfessional,
        },
      },
      {
        sourceUrls: ['https://www.mhlw.go.jp/content/12300000/jigyosho_430.csv'],
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
    expect(createProfessional).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        profession_type: 'care_manager',
        name: '丸の内訪問看護ステーション（訪問看護）',
        organization_name: '丸の内訪問看護ステーション',
        phone: '03-1234-5678',
        fax: '03-1234-5679',
        address: '東京都千代田区丸の内1-1-1',
        notes: 'MHLW care service open data auto-created (mhlw-care-service:430:1360199999)',
      },
    });
  });

  it('rejects non-official source URLs before fetch', async () => {
    const fetchImpl = vi.fn();

    await expect(
      importCareServiceOfficeOpenData(
        {
          organization: { findMany: vi.fn() },
          externalProfessional: {
            findMany: vi.fn(),
            update: vi.fn(),
            create: vi.fn(),
          },
        },
        {
          sourceUrls: ['https://example.com/jigyosho_430.csv'],
          fetchImpl: fetchImpl as typeof fetch,
        },
      ),
    ).rejects.toThrow('許可された公式取込ホストのみ指定できます');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the requested definition for service-to-profession mapping', () => {
    const records = parseCareServiceOfficeCsv(csvFixture(), careManagerDefinition);

    expect(records[0]).toMatchObject({
      serviceCode: '430',
      professionType: 'care_manager',
    });
  });
});
