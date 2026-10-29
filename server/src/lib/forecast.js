import { addDays, daysBetween, daysToExpiry, today } from './expiry.js';

/**
 * Demand forecasting.
 *
 * The base paper forecasts blood demand with an LSTM. That is a reasonable
 * choice at national scale with years of history; it is the wrong tool for a
 * single blood bank with a few hundred issue records, where it would be
 * untrainable, unexplainable and impossible for a reviewer to check.
 *
 * We use Holt's linear exponential smoothing instead. It captures level and
 * trend, needs no training infrastructure, and every number it produces can be
 * recomputed by hand from the series and the two constants below. Where the
 * history is too short to support even that, the function says so rather than
 * returning a confident-looking number.
 */

const ALPHA = 0.35; // level smoothing
const BETA = 0.15; // trend smoothing
const MIN_POINTS = 7;

/** Turn dated issue events into a dense daily count series. */
export function dailySeries(events, days = 30, asOf = today()) {
  const start = addDays(asOf, -(days - 1));
  const counts = new Map();
  for (const e of events) {
    const d = String(e.date).slice(0, 10);
    if (d >= start && d <= asOf) counts.set(d, (counts.get(d) || 0) + (e.count ?? 1));
  }
  const series = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    series.push({ date: d, value: counts.get(d) || 0 });
  }
  return series;
}

/** Holt's linear method. Returns the fitted state plus an n-day forecast. */
export function holtForecast(series, horizon = 14) {
  const values = series.map((p) => p.value);
  if (values.length < MIN_POINTS) {
    return {
      ok: false,
      reason: 'Not enough history to forecast (need at least ' + MIN_POINTS + ' days, have ' + values.length + ').',
      forecast: [],
      dailyRate: null,
    };
  }

  let level = values[0];
  let trend = values[1] - values[0];
  const fitted = [level];

  for (let i = 1; i < values.length; i++) {
    const prevLevel = level;
    level = ALPHA * values[i] + (1 - ALPHA) * (level + trend);
    trend = BETA * (level - prevLevel) + (1 - BETA) * trend;
    fitted.push(level + trend);
  }

  const lastDate = series[series.length - 1].date;
  const forecast = [];
  for (let h = 1; h <= horizon; h++) {
    forecast.push({
      date: addDays(lastDate, h),
      value: Math.max(0, Number((level + h * trend).toFixed(2))),
      projected: true,
    });
  }

  // Mean absolute error of the one-step-ahead fit, as an honest error band.
  let errSum = 0;
  for (let i = 1; i < values.length; i++) errSum += Math.abs(values[i] - fitted[i - 1]);
  const mae = Number((errSum / Math.max(1, values.length - 1)).toFixed(2));

  return {
    ok: true,
    method: "Holt's linear exponential smoothing",
    params: { alpha: ALPHA, beta: BETA },
    level: Number(level.toFixed(2)),
    trend: Number(trend.toFixed(3)),
    dailyRate: Math.max(0, Number(level.toFixed(2))),
    mae,
    forecast,
    history: series,
  };
}

/**
 * Project stock forward against forecast demand to find, for each group,
 * the day stock would run out and the units likely to expire unused.
 */
export function projectStock(units, dailyRate, horizon = 14, asOf = today()) {
  const live = units.filter((u) => daysToExpiry(u.expires_on, asOf) >= 0);
  let remaining = live.length;
  const timeline = [];
  let stockoutDate = null;

  // Units lost to expiry on each future day, independent of demand.
  const expiringOn = new Map();
  for (const u of live) {
    const d = daysBetween(asOf, u.expires_on);
    if (d >= 0 && d <= horizon) expiringOn.set(d, (expiringOn.get(d) || 0) + 1);
  }

  let wasted = 0;
  for (let d = 1; d <= horizon; d++) {
    const expired = expiringOn.get(d) || 0;
    const consumed = Math.min(remaining, dailyRate ?? 0);
    // Anything expiring that demand did not reach is a discard.
    const trulyWasted = Math.max(0, expired - Math.max(0, consumed - 0));
    remaining = Math.max(0, remaining - consumed - expired);
    wasted += Math.min(expired, trulyWasted);
    if (remaining <= 0 && !stockoutDate) stockoutDate = addDays(asOf, d);
    timeline.push({ date: addDays(asOf, d), projectedStock: Number(remaining.toFixed(1)), expiring: expired });
  }

  return {
    startingStock: live.length,
    dailyRate: dailyRate ?? null,
    stockoutDate,
    projectedWastage: Math.round(wasted),
    timeline,
    note: 'Projection from smoothed recent demand. It is a planning aid, not a guarantee of availability.',
  };
}
