/**
 * @fileoverview 添付ファイル等の大容量base64データをUint8Arrayへ変換するクライアント側実装。
 *
 * 用途は添付ファイル等の大容量データ変換に限定する。
 * 暗号鍵・IV・JWTシークレット等の小サイズ変換は`crypto.ts`等が
 * `Uint8Array.from(atob(...), (c) => c.codePointAt(0)!)`イディオムを個別に使い、
 * 本ファイルへ統合しない（用途とサイズ特性が異なるため）。
 */

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  // `String.fromCharCode(...arr)`によるスプレッド展開は引数長に上限があり、
  // 10 MiB相当の大きな配列では呼び出しスタック上限を超えるため、for-loopで代替する。
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
