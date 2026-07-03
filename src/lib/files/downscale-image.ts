/**
 * モバイル撮影画像の client 側リサイズ+圧縮の共通処理(W2-F1)。
 * 訪問記録の添付アップロード(visit-record-form.tsx の uploadVisitAttachment)と
 * 証跡撮影(capture-content.tsx の persistCapturedImage、オフラインドラフト経由の同期にも適用)
 * の両方から使う。
 *
 * - 長辺 {@link DOWNSCALE_MAX_DIMENSION_PX} を超える画像のみ JPEG 品質
 *   {@link DOWNSCALE_JPEG_QUALITY} で再エンコードする(既に上限以下の画像は無変換)。
 * - EXIF の回転情報は `createImageBitmap` の `imageOrientation: 'from-image'` で
 *   正しい向きに反映してから描画するため、回転を考慮した縮小になる。
 * - fail-open: 非画像 / HEIC 等デコード不能形式 / 変換失敗時は元の File をそのまま返す
 *   (アップロード自体は止めない)。
 */

export const DOWNSCALE_MAX_DIMENSION_PX = 1600;
export const DOWNSCALE_JPEG_QUALITY = 0.85;

export type DownscaleImageOptions = {
  /** 長辺の上限(px)。既定 {@link DOWNSCALE_MAX_DIMENSION_PX} */
  maxDimensionPx?: number;
  /** JPEG 品質(0-1)。既定 {@link DOWNSCALE_JPEG_QUALITY} */
  quality?: number;
};

function buildDownscaledFileName(originalName: string): string {
  const withoutExt = originalName.replace(/\.[^./\\]+$/, '');
  return `${withoutExt || 'image'}.jpg`;
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

/**
 * 画像 File を長辺上限にリサイズし JPEG 圧縮する。
 *
 * - 非画像ファイル(PDF 等) → 元ファイルのまま返す
 * - `createImageBitmap` 非対応環境 → 元ファイルのまま返す
 * - デコード不能形式(HEIC 等) → 変換スキップで元ファイルのまま返す
 * - 既に長辺が上限以下の画像 → 無変換で元ファイルのまま返す
 * - キャンバス取得・エンコード失敗 → fail-open で元ファイルのまま返す
 */
export async function downscaleImage(file: File, options?: DownscaleImageOptions): Promise<File> {
  const maxDimensionPx = options?.maxDimensionPx ?? DOWNSCALE_MAX_DIMENSION_PX;
  const quality = options?.quality ?? DOWNSCALE_JPEG_QUALITY;

  if (!file.type.startsWith('image/')) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // HEIC 等デコード不能形式 → 変換スキップで元ファイルを送信する
    return file;
  }

  try {
    const { width, height } = bitmap;
    if (width <= 0 || height <= 0) return file;
    if (width <= maxDimensionPx && height <= maxDimensionPx) {
      // 既に上限以下 → 無変換
      return file;
    }

    const scale = maxDimensionPx / Math.max(width, height);
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    if (!context) return file;

    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    const blob = await canvasToJpegBlob(canvas, quality);
    if (!blob) return file;

    return new File([blob], buildDownscaledFileName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    // 変換失敗 → fail-open で元ファイルを送信する
    return file;
  } finally {
    bitmap.close?.();
  }
}
