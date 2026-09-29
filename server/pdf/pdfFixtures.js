import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
// Synthetic PDFs only. Hand-built objects/xref avoid a second PDF dependency.
const passwordPadding = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const md5 = data => createHash('md5').update(data).digest();
function rc4(key, data) {
  const state = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + state[i] + key[i % key.length]) % 256; [state[i], state[j]] = [state[j], state[i]]; }
  let i = 0; j = 0;
  return Buffer.from(data.map(value => { i = (i + 1) % 256; j = (j + state[i]) % 256;
    [state[i], state[j]] = [state[j], state[i]]; return value ^ state[(state[i] + state[j]) % 256]; }));
}
export function syntheticPdf(pages = ['School holiday'], { padding = 0, encrypted = false, emptyPassword = false, imageOnly = false, textOperations = 0 } = {}) {
  const id = Buffer.from('00112233445566778899aabbccddeeff00', 'hex');
  const pad = password => Buffer.concat([Buffer.from(password), passwordPadding]).subarray(0, 32);
  const owner = rc4(md5(pad('fixture-owner')).subarray(0, 5), pad(emptyPassword ? '' : 'fixture-password'));
  const encryptionKey = md5(Buffer.concat([pad(emptyPassword ? '' : 'fixture-password'), owner, Buffer.from([252,255,255,255]), id])).subarray(0, 5);
  const user = rc4(encryptionKey, passwordPadding);

  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  const kids = [];
  for (const text of pages) {
    const page = objects.length + 1;
    kids.push(`${page} 0 R`);
    const escaped = text.replace(/[\\()]/g, '\\$&');
    let stream = imageOnly ? 'q 1 0 0 1 0 0 cm BI /W 1 /H 1 /CS /RGB /BPC 8 ID abc EI Q' : `BT /F1 0.01 Tf 10 100 Td (${escaped}) Tj ET`;
    if (textOperations) stream = deflateSync(Buffer.from('BT /F1 1 Tf ' + '1 0 0 1 10 10 Tm (a) Tj 1 0 0 1 10 20 Tm (b) Tj '.repeat(Math.ceil(textOperations / 2)) + ' ET')).toString('latin1');
    if (encrypted) stream = rc4(md5(Buffer.concat([encryptionKey, Buffer.from([(page + 1) & 255, (page + 1) >> 8, 0, 0, 0])])).subarray(0, 10), Buffer.from(stream, 'latin1')).toString('latin1');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100000 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${page + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} ${textOperations ? '/Filter /FlateDecode' : ''} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  if (encrypted) objects.push(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P -4 >>`);
  let pdf = '%PDF-1.7\n' + (padding ? '%' + ' '.repeat(padding - 2) + '\n' : '');
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encrypted ? `/Encrypt ${objects.length} 0 R /ID [<00112233445566778899aabbccddeeff00><00112233445566778899aabbccddeeff00>]` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
