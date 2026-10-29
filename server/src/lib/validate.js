/** Small request-body validator. Collects every problem instead of throwing on the first. */

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const bad = (message, details) => new HttpError(400, message, details);

export function validate(body, spec) {
  const out = {};
  const errors = {};

  for (const [field, rule] of Object.entries(spec)) {
    const raw = body?.[field];
    const absent = raw === undefined || raw === null || raw === '';

    if (absent) {
      if (rule.required) errors[field] = 'Required';
      else if ('default' in rule) out[field] = rule.default;
      else out[field] = null;
      continue;
    }

    switch (rule.type) {
      case 'int': {
        const n = Number(raw);
        if (!Number.isInteger(n)) { errors[field] = 'Must be a whole number'; break; }
        if (rule.min !== undefined && n < rule.min) { errors[field] = 'Must be at least ' + rule.min; break; }
        if (rule.max !== undefined && n > rule.max) { errors[field] = 'Must be at most ' + rule.max; break; }
        out[field] = n;
        break;
      }
      case 'number': {
        const n = Number(raw);
        if (Number.isNaN(n)) { errors[field] = 'Must be a number'; break; }
        if (rule.min !== undefined && n < rule.min) { errors[field] = 'Must be at least ' + rule.min; break; }
        if (rule.max !== undefined && n > rule.max) { errors[field] = 'Must be at most ' + rule.max; break; }
        out[field] = n;
        break;
      }
      case 'bool':
        out[field] = raw === true || raw === 'true' || raw === 1 || raw === '1' ? 1 : 0;
        break;
      case 'enum':
        if (!rule.values.includes(raw)) { errors[field] = 'Must be one of: ' + rule.values.join(', '); break; }
        out[field] = raw;
        break;
      case 'date': {
        const s = String(raw).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) { errors[field] = 'Must be a date (YYYY-MM-DD)'; break; }
        out[field] = s;
        break;
      }
      default: {
        const s = String(raw).trim();
        if (rule.minLength && s.length < rule.minLength) { errors[field] = 'Must be at least ' + rule.minLength + ' characters'; break; }
        if (rule.maxLength && s.length > rule.maxLength) { errors[field] = 'Must be at most ' + rule.maxLength + ' characters'; break; }
        out[field] = s;
      }
    }
  }

  if (Object.keys(errors).length) throw bad('Please correct the highlighted fields', errors);
  return out;
}
