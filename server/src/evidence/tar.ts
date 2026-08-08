// A deterministic, dependency-free tar (+gzip) writer for evidence packages.
//
// Reproducibility is a package requirement (docs/validator-build-plan.md V2):
// the same DB state and parameters must yield identical bytes, so every source
// of nondeterminism a normal tar carries is pinned — mtime 0, uid/gid 0, fixed
// mode, entries in the caller's (sorted) order. POSIX ustar headers; files
// only. Node's zlib gzip writes MTIME=0 in the gzip header, so the compressed
// artifact is reproducible on a given zlib build too. The canonical artifact
// remains the file set (hashed in manifest.json); the tarball is packaging.
import { gzipSync } from "node:zlib";

const BLOCK = 512;

function octal(value: number, width: number): Buffer {
  const s = value.toString(8).padStart(width - 1, "0") + "\0";
  return Buffer.from(s, "ascii");
}

function header(name: string, size: number): Buffer {
  if (Buffer.byteLength(name, "utf8") > 100) throw new Error(`tar name too long: ${name}`);
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, 100, "utf8"); // name
  octal(0o644, 8).copy(h, 100); // mode
  octal(0, 8).copy(h, 108); // uid
  octal(0, 8).copy(h, 116); // gid
  octal(size, 12).copy(h, 124); // size
  octal(0, 12).copy(h, 136); // mtime — pinned to epoch for reproducibility
  h.fill(0x20, 148, 156); // chksum: spaces while summing
  h.write("0", 156, 1, "ascii"); // typeflag: regular file
  h.write("ustar", 257, 5, "ascii"); // magic
  h.write("00", 263, 2, "ascii"); // version
  let sum = 0;
  for (const b of h) sum += b;
  const chk = sum.toString(8).padStart(6, "0") + "\0 ";
  h.write(chk, 148, 8, "ascii");
  return h;
}

/** Build a tar archive from (name, content) entries, in the order given. */
export function tarball(entries: Array<{ name: string; content: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    parts.push(header(e.name, e.content.length));
    parts.push(e.content);
    const pad = (BLOCK - (e.content.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2)); // end-of-archive
  return Buffer.concat(parts);
}

export function tarGz(entries: Array<{ name: string; content: Buffer }>): Buffer {
  return gzipSync(tarball(entries), { level: 9 });
}
