import { IMPORT_IMAGE_BYTES } from '../../shared/importPreview.js';

// Only bounded PNG/JPEG byte streams are accepted. The browser MIME type and
// filename are never trusted, and no image decoder runs in the Plannix process.
export function validateImportImage(data, contentType) {
  if (!Buffer.isBuffer(data) || !data.length || data.length > IMPORT_IMAGE_BYTES) throw Error('Invalid image.');
  if (contentType === 'image/png') {
    if (data.length < 33 || !data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      || data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR'
      || ![1, 2, 4, 8, 16].includes(data[24]) || ![0, 2, 3, 4, 6].includes(data[25])
      || (data[25] === 3 && data[24] === 16)
      || ([2, 4, 6].includes(data[25]) && ![8, 16].includes(data[24]))
      || data.toString('ascii', data.length - 8, data.length - 4) !== 'IEND') throw Error('Invalid image.');
    const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
    if (!width || !height || width * height > 20_000_000) throw Error('Invalid image.');
  } else if (contentType === 'image/jpeg') {
    if (data.length < 16 || data[0] !== 0xff || data[1] !== 0xd8
      || data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) throw Error('Invalid image.');
    let offset = 2, dimensions = false;
    while (offset + 4 < data.length) {
      if (data[offset++] !== 0xff) throw Error('Invalid image.');
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === 0xda) break;
      if (marker === 0xd9 || marker === 0x00 || offset + 2 > data.length) throw Error('Invalid image.');
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) throw Error('Invalid image.');
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 7) throw Error('Invalid image.');
        const height = data.readUInt16BE(offset + 3), width = data.readUInt16BE(offset + 5);
        if (!width || !height || width * height > 20_000_000) throw Error('Invalid image.');
        dimensions = true;
      }
      offset += length;
    }
    if (!dimensions) throw Error('Invalid image.');
  } else throw Error('Unsupported image.');
  return { mimeType: contentType, data };
}
