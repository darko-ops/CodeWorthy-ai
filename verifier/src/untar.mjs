// Minimal ustar + gzip reader — enough to open an evidence .tar.gz without any
// dependency. Regular files only; everything else in an archive is ignored.
import { gunzipSync } from "node:zlib";

const BLOCK = 512;

/**
 * @param {Buffer} tarBytes
 * @returns {Map<string, Buffer>} filename -> content
 */
export function untar(tarBytes) {
  const files = new Map();
  let off = 0;
  while (off + BLOCK <= tarBytes.length) {
    const header = tarBytes.subarray(off, off + BLOCK);
    if (header.every((b) => b === 0)) break; // end-of-archive
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const sizeField = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = parseInt(sizeField, 8);
    if (!name || Number.isNaN(size)) throw new Error(`malformed tar header at offset ${off}`);
    const typeflag = String.fromCharCode(header[156] ?? 0x30);
    const content = tarBytes.subarray(off + BLOCK, off + BLOCK + size);
    if (typeflag === "0" || typeflag === "\0") files.set(name, Buffer.from(content));
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
}

/** @param {Buffer} bytes */
export function untarGz(bytes) {
  return untar(gunzipSync(bytes));
}
