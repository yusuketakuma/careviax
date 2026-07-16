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

  export function toDataURL(
    text: string | QRCodeByteSegment[],
    options?: QRCodeToDataURLOptions,
  ): Promise<string>;
}
