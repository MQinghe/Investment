import { calculate, parseBackup, VERSION } from './ledger.js';

export const STORAGE_KEY = '@grid-journal/mobile/v1';
export function backupText(records) {
  return JSON.stringify({ app: 'grid-ledger', version: VERSION, exportedAt: new Date().toISOString(), records: calculate(records).records }, null, 2);
}
export async function loadLedger(storage) {
  const raw = await storage.getItem(STORAGE_KEY);
  if (raw === null) return { records: [], raw: null };
  try { return { records: parseBackup(raw), raw }; }
  catch (e) { const error = new Error(`本地账本无法读取：${e.message}`); error.raw = raw; throw error; }
}
export async function saveLedger(storage, next) {
  if (next.length > 20000) throw Error('账本最多支持 20,000 笔交易。');
  const records = calculate(next).records;
  await storage.setItem(STORAGE_KEY, backupText(records));
  return records;
}
