/** Format Stripe amounts in minor units (e.g. pence) for display. */
export function formatMoneyMinor(amount, currency) {
  if (typeof amount !== 'number') {
    return '';
  }
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: String(currency || 'usd').toUpperCase(),
  }).format(amount / 100);
}

/**
 * @param {object|null} price — e.g. { amount, currency, interval, intervalCount, productName }
 * @returns {string} e.g. "£9.99 per month"
 */
export function formatSubscriptionPriceSummary(price) {
  if (!price || typeof price.amount !== 'number') {
    return '';
  }
  const currency = String(price.currency || 'usd').toUpperCase();
  const money = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).format(price.amount / 100);
  const interval = price.interval || 'month';
  const n = Number(price.intervalCount) > 0 ? Number(price.intervalCount) : 1;
  const cadence =
    interval === 'month'
      ? n === 1
        ? 'per month'
        : `every ${n} months`
      : interval === 'year'
        ? n === 1
          ? 'per year'
          : `every ${n} years`
        : interval === 'week'
          ? n === 1
            ? 'per week'
            : `every ${n} weeks`
          : interval === 'day'
            ? n === 1
              ? 'per day'
              : `every ${n} days`
            : `per ${interval}`;
  return `${money} ${cadence}`;
}
