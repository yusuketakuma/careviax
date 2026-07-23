import { vi } from 'vitest';

const { allocateGlobalDisplayIdMock } = vi.hoisted(() => ({
  allocateGlobalDisplayIdMock: vi.fn(),
}));

vi.mock('@/lib/db/display-id', () => ({
  allocateGlobalDisplayId: allocateGlobalDisplayIdMock,
}));

import {
  importMhlwGenericFlags,
  importMhlwPriceList,
  importGenericNameMappings,
  parseMhlwPriceWorkbook,
  parseGenericNameWorkbook,
  previewGenericNameMappings,
  previewMhlwGenericFlags,
  previewMhlwPriceList,
  resolveLatestGenericNameWorkbookUrl,
  resolveLatestMhlwPriceListPageUrl,
  resolveLatestMhlwPriceListPageMetadata,
  resolveLatestMhlwPriceWorkbookUrl,
  resolveLatestMhlwPriceWorkbookUrls,
} from '../mhlw';
import { buildWorkbookBuffer } from '../excel';

async function workbookBlob(sheets: Record<string, (string | null)[][]>) {
  return buildWorkbookBuffer(sheets);
}

function toWorkbookResponse(buffer: Buffer) {
  return new Response(new Blob([new Uint8Array(buffer)]), {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  });
}

async function genericNameWorkbookBlob(exceptionYjCodes: Array<string | null> = ['1124001F1030']) {
  return workbookBlob({
    '一般名処方マスタ（R8.4.1版） 全体': [
      ['一般名処方マスタ'],
      [null, null, null, null, null, null, null, null, '令和8年4月1日適用'],
      [
        '区分',
        '一般名コード',
        '一般名処方の標準的な記載',
        '成分名',
        '規格',
        '一般名処方加算対象',
        '例外コード',
        '同一剤形・規格内の最低薬価',
        '備考',
      ],
      [
        '内用薬',
        '1124001F2ZZZ',
        '【般】エスタゾラム錠１ｍｇ',
        'エスタゾラム',
        '１ｍｇ１錠',
        '加算1,2',
        null,
        '6.30',
        null,
      ],
    ],
    例外コード品目対照表: [
      ['一般名処方マスタ（例外コード表）'],
      [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        '令和8年4月1日適用',
      ],
      [
        '区分',
        '一般名コード',
        '一般名処方の標準的な記載',
        '成分名',
        '規格',
        '薬価基準収載医薬品コード',
        '品名',
        null,
        null,
        null,
        'メーカー名',
        null,
        '先発医薬品',
        '同一剤形・規格の後発医薬品がある先発医薬品',
        '薬価',
        '経過措置による使用期限',
        '備考',
      ],
      ...exceptionYjCodes.map((yjCode, index) => [
        '内用薬',
        index === 0 ? '1124001F2ZZZ' : null,
        '【般】エスタゾラム錠１ｍｇ',
        'エスタゾラム',
        '１ｍｇ１錠',
        yjCode,
        null,
        null,
        null,
        null,
        '共和薬品工業',
        null,
        '後発品',
        null,
        '6.30',
        null,
        null,
      ]),
    ],
  });
}

export function getMhlwTestSupport() {
  return {
    allocateGlobalDisplayIdMock,
    genericNameWorkbookBlob,
    importGenericNameMappings,
    importMhlwGenericFlags,
    importMhlwPriceList,
    parseGenericNameWorkbook,
    parseMhlwPriceWorkbook,
    previewGenericNameMappings,
    previewMhlwGenericFlags,
    previewMhlwPriceList,
    resolveLatestGenericNameWorkbookUrl,
    resolveLatestMhlwPriceListPageMetadata,
    resolveLatestMhlwPriceListPageUrl,
    resolveLatestMhlwPriceWorkbookUrl,
    resolveLatestMhlwPriceWorkbookUrls,
    toWorkbookResponse,
    workbookBlob,
  };
}
