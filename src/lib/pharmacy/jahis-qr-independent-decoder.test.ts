import {
  BinaryBitmap,
  HybridBinarizer,
  QRCodeReader,
  ResultMetadataType,
  RGBLuminanceSource,
} from '@zxing/library';
import { create } from 'qrcode';
import { describe, expect, it } from 'vitest';
import { buildJahisQrExport, parseJahisQR, type JahisQrExportInput } from './jahis-qr';

const QUIET_ZONE_MODULES = 4;
const PIXELS_PER_MODULE = 6;

const EXPORT_INPUT = {
  patient: {
    name: '山田 太郎',
    nameKana: 'ﾔﾏﾀﾞ ﾀﾛｳ',
    gender: 'male',
    birthDate: '1945-02-03',
  },
  dispensingInstitution: {
    name: 'PH-OS薬局',
    prefCode: '13',
    scoreTableCode: '4',
    institutionCode: '7654321',
  },
  prescribingInstitution: {
    name: 'PH-OS Clinic',
    prefCode: '13',
    scoreTableCode: '1',
    institutionCode: '1234567',
  },
  prescribingDoctor: '田中 医師',
  prescribingDepartment: '内科',
  dispensingDate: '2026-03-29',
  medications: [
    {
      drugCodeType: 2,
      drugCode: '612170709',
      drugName: 'アムロジピン錠5mg',
      dose: '1',
      unit: '錠',
      usageName: '1日1回朝食後',
      dispensingQuantity: '14',
      dispensingUnit: '日分',
      formCode: 1,
      usageCodeType: 1,
    },
  ],
} satisfies JahisQrExportInput;

function renderQrLuminance(payload: Uint8Array): {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const qr = create([{ data: payload, mode: 'byte' }], { errorCorrectionLevel: 'M' });
  const dimension = (qr.modules.size + QUIET_ZONE_MODULES * 2) * PIXELS_PER_MODULE;
  const pixels = new Uint8ClampedArray(dimension * dimension);
  pixels.fill(255);

  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let column = 0; column < qr.modules.size; column += 1) {
      if (!qr.modules.get(row, column)) continue;
      const firstY = (row + QUIET_ZONE_MODULES) * PIXELS_PER_MODULE;
      const firstX = (column + QUIET_ZONE_MODULES) * PIXELS_PER_MODULE;

      for (let y = firstY; y < firstY + PIXELS_PER_MODULE; y += 1) {
        pixels.fill(0, y * dimension + firstX, y * dimension + firstX + PIXELS_PER_MODULE);
      }
    }
  }

  return { pixels, width: dimension, height: dimension };
}

function readByteSegments(value: unknown): Uint8Array {
  if (!Array.isArray(value) || value.length !== 1 || !(value[0] instanceof Uint8Array)) {
    throw new TypeError('ZXING_BYTE_SEGMENT_INVALID');
  }
  return value[0];
}

describe('JAHIS QR independent decoder conformance', () => {
  it('round-trips the rendered QR matrix through ZXing without byte reinterpretation', () => {
    const exported = buildJahisQrExport(EXPORT_INPUT);
    const image = renderQrLuminance(exported.bytes);
    const source = new RGBLuminanceSource(image.pixels, image.width, image.height);
    const result = new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source)));
    const decodedBytes = readByteSegments(
      result.getResultMetadata().get(ResultMetadataType.BYTE_SEGMENTS),
    );

    expect(decodedBytes).toEqual(exported.bytes);
    const decodedText = new TextDecoder('shift_jis').decode(decodedBytes);
    expect(decodedText).toBe(exported.text);
    expect(parseJahisQR(decodedText)).toMatchObject({
      patient: { name: '山田 太郎', nameKana: 'ﾔﾏﾀﾞ ﾀﾛｳ' },
      dispensingInstitution: { name: 'PH-OS薬局', institutionCode: '7654321' },
      prescribingInstitution: { name: 'PH-OS Clinic', institutionCode: '1234567' },
      medications: [
        {
          drugName: 'アムロジピン錠5mg',
          dose: '1',
          unit: '錠',
          usage: '1日1回朝食後',
          usageQuantity: '14',
          usageUnit: '日分',
        },
      ],
    });
  });
});
