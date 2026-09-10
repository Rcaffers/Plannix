export function registerHolidayRoutes({
  app,
  fetchJsonOrThrow,
  fetchUkBankHolidaysForYear,
  normalizeCountryCode,
  parseCoordinate,
  sendError,
}) {
  app.get('/holidays/countries', async (req, res) => {
    try {
      const data = await fetchJsonOrThrow('https://date.nager.at/api/v3/AvailableCountries');
      const countries = Array.isArray(data)
        ? data
            .map((entry) => ({
              countryCode: normalizeCountryCode(entry?.countryCode),
              name: String(entry?.name || '').trim(),
            }))
            .filter((entry) => entry.countryCode && entry.name)
            .sort((a, b) => a.name.localeCompare(b.name))
        : [];
      return res.json({ countries });
    } catch (error) {
      return sendError(res, error, 'Could not load country list.', 502);
    }
  });

  app.get('/holidays/resolve-country', async (req, res) => {
    const lat = parseCoordinate(req.query.lat);
    const lng = parseCoordinate(req.query.lng);
    if (lat == null || lng == null) {
      return res.status(400).json({ message: 'lat and lng query parameters are required.' });
    }
    try {
      const params = new URLSearchParams({
        format: 'jsonv2',
        lat: String(lat),
        lon: String(lng),
        zoom: '3',
        addressdetails: '1',
      });
      const data = await fetchJsonOrThrow(`https://nominatim.openstreetmap.org/reverse?${params}`, {
        headers: {
          'User-Agent': 'Plannix/1.0 holiday-import',
        },
      });
      const countryCode = normalizeCountryCode(data?.address?.country_code);
      const countryName = String(data?.address?.country || '').trim();
      if (!countryCode) {
        return res.status(404).json({ message: 'Could not determine country from that location.' });
      }
      return res.json({
        countryCode,
        countryName: countryName || countryCode,
      });
    } catch (error) {
      return sendError(res, error, 'Could not resolve country from location.', 502);
    }
  });

  app.get('/holidays/public', async (req, res) => {
    const countryCode = normalizeCountryCode(req.query.country);
    const year = Number.parseInt(String(req.query.year || ''), 10);
    if (!countryCode || !Number.isInteger(year) || year < 1900 || year > 2100) {
      return res.status(400).json({ message: 'Valid country and year query parameters are required.' });
    }
    try {
      if (countryCode === 'GB') {
        const ukHolidays = await fetchUkBankHolidaysForYear(year);
        if (ukHolidays.length > 0) {
          return res.json({ holidays: ukHolidays });
        }
      }

      const data = await fetchJsonOrThrow(
        `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`,
      );
      const holidays = Array.isArray(data)
        ? data
            .map((entry) => ({
              date: String(entry?.date || '').trim(),
              localName: String(entry?.localName || '').trim(),
              name: String(entry?.name || '').trim(),
            }))
            .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date))
        : [];
      return res.json({ holidays });
    } catch (error) {
      return sendError(res, error, 'Could not load public holidays.', 502);
    }
  });
}
