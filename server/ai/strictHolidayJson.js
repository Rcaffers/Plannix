// JSON.parse first validates JSON grammar. This bounded token walk then detects
// duplicate decoded property names, including escaped equivalents, at every level.
// No regular expression attempts to parse objects or quoted string contents.
export function verifyHolidayJson(_req, _res, buffer) {
  const text = buffer.toString('utf8');
  const bad = () => Object.assign(new Error('Request body must be valid JSON without duplicate keys.'), { expose: true, statusCode: 400 });
  try {
    JSON.parse(text);
    let i = 0;
    const space = () => { while (/\s/.test(text[i] || '') && i < text.length) i++; };
    const string = () => {
      const start = i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i++] === '"') return JSON.parse(text.slice(start, i));
      }
      throw bad();
    };
    const value = depth => {
      if (depth > 100) throw bad();
      space();
      if (text[i] === '"') { string(); return; }
      if (text[i] === '{') {
        i++; space(); const keys = new Set();
        if (text[i] === '}') { i++; return; }
        while (true) {
          space(); const key = string();
          if (keys.has(key)) throw bad();
          keys.add(key); space(); i++; // validated colon
          value(depth + 1); space();
          if (text[i++] === '}') return;
        }
      }
      if (text[i] === '[') {
        i++; space();
        if (text[i] === ']') { i++; return; }
        while (true) { value(depth + 1); space(); if (text[i++] === ']') return; }
      }
      while (i < text.length && !/[,}\]\s]/.test(text[i])) i++;
    };
    value(0);
  } catch { throw bad(); }
}
