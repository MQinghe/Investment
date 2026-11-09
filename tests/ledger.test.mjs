import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, normalize, exportCSV, parseCSV, parseBackup, mergeRecords, demoRecords } from '../src/ledger.js';
const buy = (id, price, qty, fee = 0) => normalize({ id, code: '000001', name: '测试证券', side: 'buy', date: '2026-10-01T10:00:00', price, qty, fee });
const sell = (id, price, qty, fee = 0, lotId = '') => normalize({ ...buy(id, price, qty, fee), side: 'sell', date: '2026-10-02T10:00:00', lotId });

test('partial sells conserve cost including allocated buy/sell fees', () => {
  const s = calculate([buy('b', 10, 300, 5), sell('s', 11, 100, 2)]);
  assert.equal(s.cost, 200333); assert.equal(s.realized, 9633); assert.equal(s.qty, 200);
  const flat = calculate([buy('b', 10, 300, 5), sell('s', 11, 100, 2), sell('s2', 11, 200, 2)]);
  assert.equal(flat.cost, 0); assert.equal(flat.qty, 0); assert.equal(flat.realized, 29100);
});
test('FIFO spans batches; explicit matching disposes selected grid lot', () => {
  const buys = [buy('a', 10, 100, 1), buy('b', 9, 100, 1)];
  const fifo = calculate([...buys, sell('s', 11, 150, 2)]);
  assert.equal(fifo.lots[0].remaining, 0); assert.equal(fifo.lots[1].remaining, 50); assert.equal(fifo.realized, 19650);
  const selected = calculate([...buys, sell('s', 11, 80, 2, 'b')]);
  assert.equal(selected.lots[0].remaining, 100); assert.equal(selected.lots[1].remaining, 20); assert.equal(selected.realized, 15720);
});
test('oversell, wrong stock, deleted or future lot are rejected', () => {
  assert.throws(() => calculate([buy('b', 10, 100), sell('s', 11, 101)]), /无法卖出/);
  assert.throws(() => calculate([sell('s', 11, 100, 0, 'missing')]), /无法卖出/);
  assert.throws(() => calculate([buy('b', 10, 100), { ...sell('s', 11, 50), date: '2026-09-01T10:00:00' }]), /无法卖出/);
  assert.throws(() => calculate([buy('b', 10, 100), { ...sell('s', 11, 50, 0, 'b'), code: '510300' }]), /无法卖出/);
});
test('time ordering and same-time insertion ordering are deterministic', () => {
  const b = buy('b', 10, 100), s = { ...sell('s', 11, 20), date: b.date };
  assert.equal(calculate([b, s]).qty, 80);
  assert.throws(() => calculate([s, b]), /无法卖出/);
  assert.equal(calculate([sell('s', 11, 100), b]).qty, 0);
});
test('CSV round trip preserves IDs, leading zero code, multiline notes and lot pairing', () => {
  const records = [ { ...buy('b', 1.234567, 100, 0.12), note: '第一格,"注释"\n第二行' }, { ...sell('s', 2, 40, 0.1, 'b'), note: '=1+1' } ];
  assert.deepEqual(parseCSV(exportCSV(records)), records);
  assert.equal(calculate(parseCSV(exportCSV(records))).qty, 60);
});
test('broker CSV accepts date/time split and total transaction fees', () => {
  const [r] = parseCSV('成交日期,成交时间,证券代码,证券名称,买卖标志,成交价格,成交数量,手续费,印花税,过户费\n20261001,10:00:00,000001,测试证券,证券买入,10,100,5,1,0.1');
  assert.equal(r.date, '2026-10-01T10:00:00'); assert.equal(r.fee, 6.1); assert.equal(r.code, '000001');
});
test('imports skip identical IDs and optionally similar existing content, not legitimate repeated file rows', () => {
  const b = buy('b', 10, 100), c = { ...b, id: 'c' };
  assert.deepEqual(mergeRecords([b], [b, c]).records, [b]);
  assert.equal(mergeRecords([b], [c], false).added, 1);
  assert.equal(mergeRecords([], [b, c]).added, 2);
  assert.throws(() => mergeRecords([b], [{ ...b, qty: 200 }]), /冲突/);
});
test('malformed records and CSV are rejected before changing ledger', () => {
  for (const overrides of [{ qty: -1 }, { qty: 0.1 }, { price: Infinity }, { fee: -1 }, { date: '2026-02-30T10:00:00' }, { side: 'split' }, { code: '<script>' }]) assert.throws(() => normalize({ ...buy('a', 10, 100), ...overrides }));
  assert.throws(() => parseCSV('证券代码,证券名称,方向,成交时间,成交价格,成交数量\n000001,"broken'), /引号/);
  assert.throws(() => parseCSV('代码,名称\n1,2'), /缺少列/);
  assert.throws(() => parseBackup('{"records":[]}'), /不.*支持|不是支持/);
});
test('backup round trip and demo accounting match known totals', () => {
  const records = demoRecords(), result = calculate(records);
  assert.equal(result.qty, 2700); assert.equal(result.cost, 2046900); assert.equal(result.realized, 13900);
  const json = JSON.stringify({ app: 'grid-ledger', version: 1, records });
  assert.deepEqual(parseBackup(json), records);
});
