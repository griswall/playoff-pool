export function parsePoints(raw) {
  if (!/^[+-]?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(raw) || Math.abs(Number(raw)) > 999.99) {
    throw new Error('Points must be between -999.99 and 999.99 with at most two decimal places.');
  }
  return Number(raw);
}
