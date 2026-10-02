import { Readable } from 'node:stream';
import { createInflateRaw, crc32 } from 'node:zlib';
import { zipSync } from 'fflate';

export const XLSX_ARCHIVE_LIMITS = Object.freeze({ entries: 128, entryBytes: 2 * 1024 * 1024,
  totalBytes: 8 * 1024 * 1024, compressionRatio: 200 });

const invalid = () => Error('Invalid XLSX archive.');
const u16 = (data, offset) => data.readUInt16LE(offset);
const u32 = (data, offset) => data.readUInt32LE(offset);
const signature = (data, offset, value) => offset >= 0 && offset + 4 <= data.length && u32(data, offset) === value;

function directory(data) {
  let end = -1;
  for (let offset = data.length - 22; offset >= Math.max(0, data.length - 65557); offset--) {
    if (signature(data, offset, 0x06054b50) && offset + 22 + u16(data, offset + 20) === data.length) { end = offset; break; }
  }
  if (end < 0 || u16(data, end + 4) || u16(data, end + 6)
    || u16(data, end + 8) !== u16(data, end + 10)) throw invalid();
  const count = u16(data, end + 10), length = u32(data, end + 12), start = u32(data, end + 16);
  if (!count || count > XLSX_ARCHIVE_LIMITS.entries || count === 0xffff || length === 0xffffffff
    || start === 0xffffffff || start + length !== end) throw invalid();
  const entries = [], names = new Set();
  let offset = start, total = 0;
  for (let index = 0; index < count; index++) {
    if (!signature(data, offset, 0x02014b50) || offset + 46 > end) throw invalid();
    const flags = u16(data, offset + 8), method = u16(data, offset + 10);
    const crc = u32(data, offset + 16), compressed = u32(data, offset + 20), expanded = u32(data, offset + 24);
    const nameLength = u16(data, offset + 28), extraLength = u16(data, offset + 30), commentLength = u16(data, offset + 32);
    const localOffset = u32(data, offset + 42);
    if ((flags & ~0x0808) !== 0 || ![0, 8].includes(method) || !nameLength
      || compressed === 0xffffffff || expanded === 0xffffffff || localOffset === 0xffffffff
      || expanded > XLSX_ARCHIVE_LIMITS.entryBytes || compressed > data.length
      || (expanded > 4096 && expanded / Math.max(compressed, 1) > XLSX_ARCHIVE_LIMITS.compressionRatio)) throw invalid();
    total += expanded;
    if (total > XLSX_ARCHIVE_LIMITS.totalBytes || offset + 46 + nameLength + extraLength + commentLength > end) throw invalid();
    const nameBytes = data.subarray(offset + 46, offset + 46 + nameLength);
    let name;
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes); } catch { throw invalid(); }
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')
      || /[\u0000-\u001f\u007f]/u.test(name) || names.has(name)) throw invalid();
    names.add(name);
    if (!signature(data, localOffset, 0x04034b50) || localOffset + 30 > start
      || u16(data, localOffset + 6) !== flags || u16(data, localOffset + 8) !== method
      || u16(data, localOffset + 26) !== nameLength) throw invalid();
    const localExtra = u16(data, localOffset + 28), contentStart = localOffset + 30 + nameLength + localExtra;
    if (contentStart + compressed > start || !data.subarray(localOffset + 30, localOffset + 30 + nameLength).equals(nameBytes)
      || (!(flags & 8) && (u32(data, localOffset + 14) !== crc
        || u32(data, localOffset + 18) !== compressed || u32(data, localOffset + 22) !== expanded))) throw invalid();
    entries.push({ name, method, crc, compressed, expanded, localOffset, contentStart, contentEnd: contentStart + compressed });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== end) throw invalid();
  const ordered = [...entries].sort((a, b) => a.localOffset - b.localOffset);
  if (ordered.some((entry, index) => index && entry.localOffset < ordered[index - 1].contentEnd)) throw invalid();
  return entries;
}

async function expand(data, entry) {
  const compressed = data.subarray(entry.contentStart, entry.contentEnd);
  if (entry.method === 0) {
    if (compressed.length !== entry.expanded || crc32(compressed) !== entry.crc) throw invalid();
    return compressed;
  }
  const inflater = createInflateRaw(), chunks = [];
  const source = Readable.from((function* () {
    for (let offset = 0; offset < compressed.length; offset += 16 * 1024) yield compressed.subarray(offset, offset + 16 * 1024);
  })());
  let length = 0, checksum = 0;
  source.pipe(inflater);
  try {
    for await (const chunk of inflater) {
      length += chunk.length;
      if (length > XLSX_ARCHIVE_LIMITS.entryBytes || length > entry.expanded
        || (length > 4096 && length / Math.max(entry.compressed, 1) > XLSX_ARCHIVE_LIMITS.compressionRatio)) throw invalid();
      checksum = crc32(chunk, checksum);
      chunks.push(chunk);
    }
    if (length !== entry.expanded || checksum !== entry.crc) throw invalid();
    return Buffer.concat(chunks, length);
  } catch { throw invalid(); }
  finally { source.destroy(); inflater.destroy(); }
}

// Repack only validated bytes with no compression. The spreadsheet parser
// receives this archive, so it cannot reinterpret hostile compressed input.
export async function validateXlsxArchive(data) {
  if (!Buffer.isBuffer(data)) throw invalid();
  const entries = directory(data), safe = Object.create(null);
  let actualTotal = 0;
  for (const entry of entries) {
    const contents = await expand(data, entry);
    actualTotal += contents.length;
    if (actualTotal > XLSX_ARCHIVE_LIMITS.totalBytes) throw invalid();
    safe[entry.name] = contents;
  }
  return Buffer.from(zipSync(safe, { level: 0 }));
}
