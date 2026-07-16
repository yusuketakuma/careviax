declare module 'qrcode' {
  export type QRCodeToDataURLOptions = {
    errorCorrectionLevel?: 'low' | 'medium' | 'quartile' | 'high' | 'L' | 'M' | 'Q' | 'H';
    margin?: number;
    scale?: number;
    width?: number;
    toSJISFunc?: (character: string) => number;
  };

  export type QRCodeByteSegment = {
    data: Uint8Array;
    mode: 'byte';
  };

  export type QRCodeCreateResult = {
    modules: {
      size: number;
      get(row: number, column: number): number;
    };
  };

  export function create(
    text: string | QRCodeByteSegment[],
    options?: Pick<QRCodeToDataURLOptions, 'errorCorrectionLevel'>,
  ): QRCodeCreateResult;

  export function toDataURL(
    text: string | QRCodeByteSegment[],
    options?: QRCodeToDataURLOptions,
  ): Promise<string>;
}
