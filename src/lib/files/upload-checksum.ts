const UPLOAD_CHECKSUM_ERROR_MESSAGE =
  'ファイルの整合性確認に失敗しました。ブラウザーを更新して再試行してください';

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function computeUploadSha256Hex(file: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(UPLOAD_CHECKSUM_ERROR_MESSAGE);
  }

  try {
    const digest = await subtle.digest('SHA-256', await file.arrayBuffer());
    return bytesToHex(new Uint8Array(digest));
  } catch {
    throw new Error(UPLOAD_CHECKSUM_ERROR_MESSAGE);
  }
}
