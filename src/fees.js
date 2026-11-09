import { money } from './ledger.js';

// User's all-in commission: 0.01%, minimum CNY 0.50 per record.
// Exchange handling / regulatory fees are included, never added a second time.
// Ordinary mainland stocks: transfer 0.001%; stamp duty only on sales.
// Sources and scope are recorded in README.md. Stored fees remain authoritative.
export function inferFeeKind(code, name = '') {
  const value = String(code).trim().toUpperCase().replace(/^(SH|SZ)/, '').replace(/\.(SH|SZ)$/, '');
  if (!value || value === 'DEMO-A') return 'stock';
  if (value === 'DEMO-B' || /^(?:5[1268]|1[56])\d{4}$/.test(value)) return 'fund';
  if (/^(?:60[0135]|688|00[0-3]|30[01])\d{3}$/.test(value)) return 'stock';
  return 'manual';
}

export function estimateFees({ price, qty, side, kind, date }) {
  const p = Number(price), q = Number(qty), day = String(date || '').slice(0, 10);
  // Older records / other markets require actual fees instead of today's rates.
  if (!['stock', 'fund'].includes(kind) || !['buy', 'sell'].includes(side) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < '2022-04-29' ||
      !Number.isFinite(p) || p <= 0 || p > 1e6 || !Number.isSafeInteger(q) || q <= 0 || q > 1e8 || p * q > 1e12) return null;
  const amount = money(p * q);
  const commission = Math.max(50, Math.round(amount / 10000));
  const transfer = kind === 'stock' ? Math.round(amount / 100000) : 0;
  const stamp = kind === 'stock' && side === 'sell' ? Math.round(amount / (day < '2023-08-28' ? 1000 : 2000)) : 0;
  return { amount, commission, transfer, stamp, total: commission + transfer + stamp };
}

export function stepQuantity(value, direction) {
  const current = Number(value);
  if (!Number.isSafeInteger(current) || current <= 0) return direction > 0 ? '100' : value;
  const next = current + (direction > 0 ? 100 : -100);
  return next > 0 && next <= 1e8 ? String(next) : value;
}
