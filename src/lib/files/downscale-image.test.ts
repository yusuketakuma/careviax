// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DOWNSCALE_JPEG_QUALITY,
  DOWNSCALE_MAX_DIMENSION_PX,
  downscaleImage,
} from './downscale-image';

type FakeBitmap = { width: number; height: number; close: ReturnType<typeof vi.fn> };

function stubCreateImageBitmap(
  impl: (file: File, options?: ImageBitmapOptions) => Promise<FakeBitmap>,
) {
  vi.stubGlobal('createImageBitmap', vi.fn(impl));
}

function stubCanvas(args: {
  context: { drawImage: ReturnType<typeof vi.fn> } | null;
  blob: Blob | null;
}) {
  const drawImage = args.context?.drawImage ?? vi.fn();
  const canvasEl = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => (args.context ? { drawImage } : null)),
    toBlob: vi.fn((callback: (blob: Blob | null) => void) => {
      callback(args.blob);
    }),
  } as unknown as HTMLCanvasElement;

  const originalCreateElement = document.createElement.bind(document);
  const createElementSpy = vi
    .spyOn(document, 'createElement')
    .mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      if (tagName === 'canvas') return canvasEl;
      return originalCreateElement(tagName, options);
    });

  return { canvasEl, drawImage, createElementSpy };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('downscaleImage', () => {
  it('returns the original file unchanged for non-image mime types', async () => {
    const file = new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' });
    const result = await downscaleImage(file);
    expect(result).toBe(file);
  });

  it('returns the original file unchanged when already within the size cap', async () => {
    const file = new File(['small'], 'small.jpg', { type: 'image/jpeg' });
    stubCreateImageBitmap(async () => ({
      width: DOWNSCALE_MAX_DIMENSION_PX,
      height: 900,
      close: vi.fn(),
    }));

    const result = await downscaleImage(file);
    expect(result).toBe(file);
  });

  it('fails open and returns the original file when decoding is unsupported (e.g. HEIC)', async () => {
    const file = new File(['heic-bytes'], 'photo.heic', { type: 'image/heic' });
    stubCreateImageBitmap(async () => {
      throw new Error('decode not supported');
    });

    const result = await downscaleImage(file);
    expect(result).toBe(file);
  });

  it('fails open and returns the original file when createImageBitmap is unavailable', async () => {
    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
    vi.stubGlobal('createImageBitmap', undefined);

    const result = await downscaleImage(file);
    expect(result).toBe(file);
  });

  it('downscales an oversized image to the max dimension and re-encodes as JPEG', async () => {
    const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
    const closeMock = vi.fn();
    stubCreateImageBitmap(async (input) => {
      expect(input).toBe(file);
      return { width: 3200, height: 1600, close: closeMock };
    });

    const outputBlob = new Blob(['resized'], { type: 'image/jpeg' });
    const { drawImage } = stubCanvas({ context: { drawImage: vi.fn() }, blob: outputBlob });

    const result = await downscaleImage(file);

    // 3200x1600 -> long edge capped at 1600 -> 1600x800
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 800);
    expect(result).not.toBe(file);
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('photo.jpg');
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('respects custom maxDimensionPx and quality options', async () => {
    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
    stubCreateImageBitmap(async () => ({ width: 2000, height: 1000, close: vi.fn() }));

    const outputBlob = new Blob(['resized'], { type: 'image/jpeg' });
    const { drawImage } = stubCanvas({ context: { drawImage: vi.fn() }, blob: outputBlob });

    const result = await downscaleImage(file, { maxDimensionPx: 800, quality: 0.5 });

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 400);
    expect(result.type).toBe('image/jpeg');
  });

  it('falls back to the original file when canvas 2d context is unavailable', async () => {
    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
    stubCreateImageBitmap(async () => ({ width: 3200, height: 3200, close: vi.fn() }));
    stubCanvas({ context: null, blob: null });

    const result = await downscaleImage(file);
    expect(result).toBe(file);
  });

  it('falls back to the original file when toBlob yields no blob', async () => {
    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
    stubCreateImageBitmap(async () => ({ width: 3200, height: 3200, close: vi.fn() }));
    stubCanvas({ context: { drawImage: vi.fn() }, blob: null });

    const result = await downscaleImage(file);
    expect(result).toBe(file);
  });

  it('exports the documented defaults', () => {
    expect(DOWNSCALE_MAX_DIMENSION_PX).toBe(1600);
    expect(DOWNSCALE_JPEG_QUALITY).toBe(0.85);
  });
});
