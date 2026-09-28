// Category is deliberately excluded: duplicates span school and public holidays.
export const holidayDuplicateKey = holiday => JSON.stringify([
  String(holiday.label || '').normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase(),
  holiday.startDate, holiday.endDate || holiday.startDate,
]);

