import { normalizePdfText } from './pdfText.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const monthIndex = value => MONTHS.findIndex(month => month.toLowerCase() === value.toLowerCase());
const position = item => ({ x: item.transform?.[4], y: item.transform?.[5] });
const horizontal = item => Math.abs(item.transform?.[0] || 0) > 2 * Math.abs(item.transform?.[1] || 0);
const vertical = item => Math.abs(item.transform?.[1] || 0) > 2 * Math.abs(item.transform?.[0] || 0);

// This handles a printed horizontal strip of day columns. Other PDF layouts
// retain their ordinary text; a weak alignment must not manufacture dates.
export function calendarPageLayout(items, pageNumber) {
  const labelled = items.filter(item => typeof item.str === 'string' && Array.isArray(item.transform)
    && item.transform.length >= 6 && Number.isFinite(position(item).x) && Number.isFinite(position(item).y));
  const months = labelled.filter(item => horizontal(item) && monthIndex(item.str.trim()) >= 0)
    .sort((a, b) => position(a).x - position(b).x);
  if (months.length < 2) return null;
  const rows = new Map();
  for (const item of labelled) {
    if (!horizontal(item) || !/^(?:[1-9]|[12]\d|3[01])$/.test(item.str.trim())) continue;
    const y = Math.round(position(item).y);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(item);
  }
  const [dateY, dateRow] = [...rows].sort((a, b) => b[1].length - a[1].length)[0] || [];
  if (!dateRow || dateRow.length < 14 || !months.every(item => Math.abs(position(item).y - dateY) <= 24)) return null;
  const dates = dateRow.sort((a, b) => position(a).x - position(b).x);
  if (dates.some((item, index) => index && position(item).x <= position(dates[index - 1]).x)) return null;
  const runs = [];
  for (const item of dates) {
    const day = Number(item.str.trim());
    if (!runs.length || day <= runs.at(-1).at(-1).day) runs.push([]);
    else if (day !== runs.at(-1).at(-1).day + 1) return null;
    runs.at(-1).push({ day, x: position(item).x });
  }
  if (runs.length < months.length || runs.length > months.length + 1) return null;
  const allDates = runs.flat();
  const spacing = (allDates.at(-1).x - allDates[0].x) / (allDates.length - 1);
  if (!Number.isFinite(spacing) || spacing < 4 || spacing > 30) return null;
  const used = new Set();
  let previousRun = -1, previousMonth = null;
  for (const heading of months) {
    const x = position(heading).x;
    const candidate = runs.map((run, index) => ({ index,
      distance: Math.abs(x - (run[0].x + run.at(-1).x) / 2) }))
      .filter(item => !used.has(item.index)).sort((a, b) => a.distance - b.distance)[0];
    const month = monthIndex(heading.str.trim());
    if (!candidate || candidate.distance > 16 * spacing || candidate.index <= previousRun
      || (previousMonth !== null && month !== (previousMonth + 1) % 12)) return null;
    const maxDay = [31,29,31,30,31,30,31,31,30,31,30,31][month];
    if (runs[candidate.index].some(date => date.day > maxDay)) return null;
    used.add(candidate.index);
    runs[candidate.index].month = MONTHS[month];
    previousRun = candidate.index; previousMonth = month;
  }
  const anchors = runs.flatMap(run => run.map(date => ({ ...date, month: run.month || null })));
  const placed = [], unresolved = [];
  for (const item of labelled) {
    const title = item.str.trim();
    if (!title || /^(?:[1-9]|[12]\d|3[01])$/.test(title) || monthIndex(title) >= 0) continue;
    if (vertical(item) && Math.abs(item.transform[1]) <= 6.5 && position(item).y < dateY - 12) {
      const nearest = anchors.map((anchor, index) => ({ anchor, index,
        distance: Math.abs(position(item).x - anchor.x) })).sort((a, b) => a.distance - b.distance)[0];
      if (nearest && nearest.distance <= Math.min(7, spacing * 0.7)) {
        placed.push({ ...nearest, title, y: position(item).y });
        continue;
      }
    }
    if (vertical(item) && Math.abs(item.transform[1]) > 6.5) continue;
    if (!vertical(item) && !horizontal(item)) continue;
    // Administrative labels and unaligned text remain review-only.
    if (title.length > 3 && !/^(?:Print|QA|Home|SLT)$/i.test(title)) unresolved.push(title);
  }
  if (!placed.length) return null;
  const groups = new Map();
  for (const entry of placed) {
    const key = `${entry.title}\u0000${Math.round(entry.y / 3)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const lines = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.index - b.index);
    let start = 0;
    for (let i = 1; i <= group.length; i++) {
      if (i < group.length && group[i].index === group[i - 1].index + 1
        && group[i].anchor.month === group[i - 1].anchor.month) continue;
      const first = group[start], last = group[i - 1];
      const date = first.anchor.month
        ? `${first.anchor.month} ${first.anchor.day}${last.index !== first.index ? `–${last.anchor.day}` : ''}`
        : `day ${first.anchor.day}${last.index !== first.index ? `–${last.anchor.day}` : ''} (month unlabelled)`;
      lines.push({ index:first.index, y:first.y, text:`${date}: ${first.title}` });
      start = i;
    }
  }
  lines.sort((a, b) => a.index - b.index || b.y - a.y);
  return normalizePdfText([`Page ${pageNumber}: labels aligned with printed day columns. Ranges denote repeated labels on consecutive columns.`,
    ...lines.map(line => line.text),
    ...[...new Set(unresolved)].map(title => `Unresolved label (no reliable date): ${title}`)].join('\n'));
}
