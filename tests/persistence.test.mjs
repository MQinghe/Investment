import test from 'node:test';
import assert from 'node:assert/strict';
import { backupText, loadLedger, saveLedger, STORAGE_KEY } from '../src/persistence.js';
import { demoRecords } from '../src/ledger.js';

test('mobile saves the same backup format as the web ledger and restores it on restart', async () => {
  const values = new Map(); const storage = { getItem: async k => values.get(k) ?? null, setItem: async (k, v) => values.set(k, v) };
  assert.deepEqual((await loadLedger(storage)).records, []);
  const records = demoRecords(); await saveLedger(storage, records);
  assert.deepEqual((await loadLedger(storage)).records, records);
  const json = JSON.parse(values.get(STORAGE_KEY)); assert.equal(json.app, 'grid-ledger'); assert.equal(json.version, 1);
});
test('invalid transactions do not overwrite previously saved data', async () => {
  let stored = backupText(demoRecords()), writes = 0;
  const storage = { getItem: async () => stored, setItem: async (_, v) => { stored = v; writes++; } };
  const original = stored;
  await assert.rejects(saveLedger(storage, [{ ...demoRecords()[0], qty: -100 }]), /成交数量/);
  assert.equal(stored, original); assert.equal(writes, 0);
});
test('a failed storage write propagates; corrupted storage is preserved for recovery', async () => {
  await assert.rejects(saveLedger({ setItem: async () => { throw Error('disk full'); } }, demoRecords()), /disk full/);
  const damaged = '{broken data';
  try { await loadLedger({ getItem: async () => damaged }); assert.fail('must reject'); }
  catch (e) { assert.equal(e.raw, damaged); assert.match(e.message, /本地账本无法读取/); }
});
