import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateFees, inferFeeKind, stepQuantity } from '../src/fees.js';
import { calculate, normalize, parseCSV, exportCSV } from '../src/ledger.js';

const quote = (overrides = {}) => estimateFees({ price: 10, qty: 100, side: 'buy', kind: 'stock', date: '2026-11-09', ...overrides });

test('all-in commission uses a 0.50 floor and charges stock transfer in both directions', () => {
  assert.deepEqual(quote(), { amount: 100000, commission: 50, transfer: 1, stamp: 0, total: 51 });
  assert.deepEqual(quote({ side: 'sell' }), { amount: 100000, commission: 50, transfer: 1, stamp: 50, total: 101 });
  assert.equal(quote({ qty: 1000 }).commission, 100);
  assert.equal(quote({ qty: 1000, side: 'sell' }).total, 610);
  assert.equal(quote({ qty: 499 }).commission, 50);
  assert.equal(quote({ qty: 500 }).commission, 50);
  assert.equal(quote({ qty: 510 }).commission, 51);
});

test('fund purchases and sales have no stock stamp duty or transfer fee', () => {
  for (const side of ['buy', 'sell']) {
    assert.deepEqual(quote({ kind: 'fund', side }), { amount: 100000, commission: 50, transfer: 0, stamp: 0, total: 50 });
  }
});

test('stamp duty follows the transaction date, and unsupported drafts have no estimate', () => {
  assert.equal(quote({ side: 'sell', date: '2023-08-27' }).stamp, 100);
  assert.equal(quote({ side: 'sell', date: '2023-08-28' }).stamp, 50);
  for (const input of [{ date: '2022-04-28' }, { kind: 'manual' }, { price: '' }, { price: 'abc' }, { qty: -100 }, { qty: 1.5 }, { qty: 1e8 + 1 }]) assert.equal(quote(input), null);
});

test('each fee rounds to cents before summation, including half-cent transfer', () => {
  assert.deepEqual(quote({ price: 5, qty: 100, side: 'sell' }), { amount: 50000, commission: 50, transfer: 1, stamp: 25, total: 76 });
  const fees = quote({ price: 12.345, qty: 100, side: 'sell' });
  assert.equal(fees.total, fees.commission + fees.transfer + fees.stamp);
});

test('recognition separates stocks, funds, and instruments requiring manual fees', () => {
  for (const code of ['600000', '000001', '300750', '688001', 'SH600000', '000001.SZ']) assert.equal(inferFeeKind(code), 'stock');
  for (const code of ['510300', '159915', '513100', '588000', '161725']) assert.equal(inferFeeKind(code), 'fund');
  for (const code of ['00700', '113001', '200001', '900901', '689009', 'AAPL']) assert.equal(inferFeeKind(code), 'manual');
});

test('quantity buttons move exactly 100 without creating zero, negative or excessive quantities', () => {
  assert.equal(stepQuantity('100', 1), '200');
  assert.equal(stepQuantity('200', -1), '100');
  assert.equal(stepQuantity('100', -1), '100');
  assert.equal(stepQuantity('150', -1), '50');
  assert.equal(stepQuantity('50', -1), '50');
  assert.equal(stepQuantity('', 1), '100');
  assert.equal(stepQuantity('100000000', 1), '100000000');
});

test('estimated or manually overridden fees survive export and feed actual ledger profit', () => {
  const buy = normalize({ id: 'b', code: '600000', name: '测试', side: 'buy', date: '2026-11-09T09:30:00', price: 10, qty: 100, fee: quote().total / 100 });
  const sell = normalize({ ...buy, id: 's', side: 'sell', price: 11, date: '2026-11-09T10:30:00', fee: quote({ price: 11, side: 'sell' }).total / 100 });
  const records = parseCSV(exportCSV([buy, sell]));
  assert.equal(calculate(records).realized, 9843);
  assert.equal(calculate([buy, { ...sell, fee: 2.34 }]).realized, 9715);
});
