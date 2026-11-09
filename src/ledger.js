export const VERSION = 1;
export const uid = () => globalThis.crypto?.randomUUID?.() || `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const money = n => Math.round((n + Number.EPSILON) * 100);
export function normalize(raw) {
  const t = {
    id: String(raw.id || uid()), code: String(raw.code ?? '').trim().toUpperCase(),
    name: String(raw.name ?? '').trim(), side: raw.side,
    date: String(raw.date ?? ''), price: Number(raw.price), qty: Number(raw.qty),
    fee: Number(raw.fee ?? 0), note: String(raw.note ?? '').trim(), lotId: String(raw.lotId || '')
  };
  if (!/^[A-Z0-9.\-]{1,20}$/.test(t.code)) throw Error('证券代码请使用 1–20 位字母、数字、点或短横线。');
  if (!t.name || t.name.length > 40) throw Error('请输入证券名称（最多 40 个字）。');
  if (!['buy', 'sell'].includes(t.side)) throw Error('交易方向只能为买入或卖出。');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(t.date)) throw Error('请填写有效的成交日期和时间。');
  if (t.date.length === 16) t.date += ':00';
  const d = new Date(t.date + 'Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, t.date.length) !== t.date) throw Error('成交日期或时间无效。');
  if (!(Number.isFinite(t.price) && t.price > 0 && t.price <= 1e6)) throw Error('成交价格须大于 0，且不超过 1,000,000。');
  if (!(Number.isSafeInteger(t.qty) && t.qty > 0 && t.qty <= 1e8)) throw Error('成交数量须为 1 至 100,000,000 的整数。');
  if (t.price * t.qty > 1e12) throw Error('单笔成交金额超出支持范围。');
  if (!(Number.isFinite(t.fee) && t.fee >= 0 && t.fee <= 1e9)) throw Error('费用须为 0 至 1,000,000,000 的数字。');
  if (t.note.length > 500 || t.id.length > 100 || t.lotId.length > 100) throw Error('备注或记录标识过长。');
  t.fee = money(t.fee) / 100;
  if (t.side === 'buy') t.lotId = '';
  return t;
}

// Ledger matching is a bookkeeping convention, not an exchange settlement rule.
// Costs are kept in cents; the last disposal receives any rounding remainder.
export function calculate(records) {
  const normalized = records.map(normalize);
  if (new Set(normalized.map(t => t.id)).size !== normalized.length) throw Error('存在重复的记录 ID。');
  const ordered = normalized.map((t, i) => ({ ...t, order: i })).sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  const lots = [], sales = [], stocks = new Map();
  let realized = 0, fees = 0;
  for (const t of ordered) {
    const gross = money(t.price * t.qty), fee = money(t.fee);
    fees += fee;
    if (!stocks.has(t.code)) stocks.set(t.code, { code: t.code, name: t.name, qty: 0, cost: 0, realized: 0, trades: 0 });
    const stock = stocks.get(t.code);
    stock.name = t.name; stock.trades++;
    if (t.side === 'buy') {
      lots.push({ ...t, remaining: t.qty, remainingCost: gross + fee, cost: gross + fee });
    } else {
      const candidates = lots.filter(l => l.code === t.code && l.remaining > 0 && (!t.lotId || l.id === t.lotId));
      const available = candidates.reduce((sum, l) => sum + l.remaining, 0);
      if (available < t.qty) throw Error(`${t.date.replace('T', ' ')} ${t.name}：${t.lotId ? '指定批次' : '此前记录'}仅有 ${available} 股可配对，无法卖出 ${t.qty} 股。请先补全买入记录。`);
      let left = t.qty, cost = 0;
      const matches = [];
      for (const l of candidates) {
        if (!left) break;
        const qty = Math.min(left, l.remaining);
        const allocatedCost = qty === l.remaining ? l.remainingCost : Math.round(l.remainingCost * qty / l.remaining);
        l.remaining -= qty; l.remainingCost -= allocatedCost; left -= qty; cost += allocatedCost;
        matches.push({ lotId: l.id, qty, cost: allocatedCost, price: l.price });
      }
      const profit = gross - fee - cost;
      sales.push({ ...t, gross, net: gross - fee, cost, profit, matches });
      realized += profit; stock.realized += profit;
    }
  }
  for (const l of lots) {
    const s = stocks.get(l.code); s.qty += l.remaining; s.cost += l.remainingCost;
  }
  return { lots, sales, stocks: [...stocks.values()], realized, fees, qty: lots.reduce((s, l) => s + l.remaining, 0), cost: lots.reduce((s, l) => s + l.remainingCost, 0), records: normalized };
}

const headers = ['记录ID', '成交时间', '证券代码', '证券名称', '方向', '成交价格', '成交数量', '费用', '关联买入ID', '备注'];
const escapeCell = x => {
  let s = String(x ?? '');
  // Keep text inert when opened by a spreadsheet; strip this prefix on import.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
export function exportCSV(records) {
  return '\uFEFF' + [headers, ...records.map(t => [t.id, t.date.replace('T', ' '), t.code, t.name, t.side === 'buy' ? '买入' : '卖出', t.price, t.qty, t.fee, t.lotId, t.note])].map(row => row.map(escapeCell).join(',')).join('\r\n');
}

export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const delimiter = text.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ',';
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || cell === '') quoted = !quoted;
      else throw Error('CSV 引号格式无效，请使用模板。');
    } else if (c === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some(x => x.trim())) rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw Error('CSV 存在未闭合的引号。');
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  if (rows.length < 2) throw Error('文件中没有交易记录。');
  const keys = rows.shift().map(x => x.trim());
  const aliases = { id: ['记录ID'], date: ['成交时间', '时间', 'date'], day: ['成交日期', '日期'], code: ['证券代码', '股票代码', 'code'], name: ['证券名称', '股票名称', 'name'], side: ['方向', '买卖标志', '操作', 'side'], price: ['成交价格', '成交均价', '价格', 'price'], qty: ['成交数量', '数量', 'qty'], fee: ['费用', '总费用', 'fee'], lotId: ['关联买入ID', 'lotId'], note: ['备注', 'note'] };
  const find = (r, names) => { const i = keys.findIndex(k => names.includes(k)); return i < 0 ? '' : String(r[i] ?? '').replace(/^'(?=[=+\-@\t\r])/, '').trim(); };
  for (const k of ['code', 'name', 'side', 'price', 'qty']) if (!keys.some(h => aliases[k].includes(h))) throw Error(`缺少列：${aliases[k][0]}。请下载 CSV 模板核对列名。`);
  if (!keys.some(h => [...aliases.date, ...aliases.day].includes(h))) throw Error('缺少成交时间或成交日期列。');
  return rows.map((r, i) => {
    if (r.length !== keys.length) throw Error(`第 ${i + 2} 行列数与表头不一致。`);
    try {
      const t = Object.fromEntries(Object.entries(aliases).map(([k, names]) => [k, find(r, names)]));
      t.side = /^(买入|证券买入|买|buy)$/i.test(t.side) ? 'buy' : /^(卖出|证券卖出|卖|sell)$/i.test(t.side) ? 'sell' : t.side;
      let date = t.day ? `${t.day} ${t.date || '00:00:00'}` : t.date;
      date = date.replace(/^(\d{4})(\d{2})(\d{2})/, '$1-$2-$3').replaceAll('/', '-').replace(' ', 'T');
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) date += 'T00:00:00';
      t.date = date;
      if (!t.fee) t.fee = ['手续费', '印花税', '过户费'].reduce((sum, h) => sum + Number(find(r, [h]) || 0), 0);
      return normalize(t);
    } catch (e) { throw Error(`第 ${i + 2} 行：${e.message}`); }
  });
}

export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw Error('JSON 文件格式无效。'); }
  if (data.app !== 'grid-ledger' || data.version !== VERSION || !Array.isArray(data.records)) throw Error('这不是支持的持仓手记备份文件。');
  if (data.records.length > 20000) throw Error('一次最多导入 20,000 笔交易。');
  const records = data.records.map(normalize);
  calculate(records);
  return records;
}
export function signature(t) { return JSON.stringify([t.code, t.date.replace(/:00$/, ''), t.side, t.price, t.qty, t.fee, t.note, t.lotId]); }
export function mergeRecords(existing, incoming, skipSimilar = true) {
  const result = existing.map(normalize), ids = new Map(result.map(t => [t.id, t])), initialSignatures = new Set(result.map(signature));
  let skipped = 0;
  for (const raw of incoming) {
    const t = normalize(raw), same = ids.get(t.id);
    if (same) {
      if (JSON.stringify(same) !== JSON.stringify(t)) throw Error('同一记录 ID 的内容发生冲突；请先在流水中核对。');
      skipped++; continue;
    }
    if (skipSimilar && initialSignatures.has(signature(t))) { skipped++; continue; }
    result.push(t); ids.set(t.id, t);
  }
  if (result.length > 20000) throw Error('账本最多支持 20,000 笔交易。');
  calculate(result);
  return { records: result, added: result.length - existing.length, skipped };
}

export function demoRecords() {
  return [
    { id: 'demo-1', code: 'DEMO-A', name: '示例股票', side: 'buy', date: '2026-10-12T10:05', price: 10.5, qty: 500, fee: 5, note: '第一格 · 初始买入' },
    { id: 'demo-2', code: 'DEMO-A', name: '示例股票', side: 'buy', date: '2026-10-14T14:20', price: 10, qty: 500, fee: 5, note: '第二格' },
    { id: 'demo-3', code: 'DEMO-A', name: '示例股票', side: 'buy', date: '2026-10-16T09:45', price: 9.5, qty: 500, fee: 5, note: '第三格' },
    { id: 'demo-4', code: 'DEMO-A', name: '示例股票', side: 'sell', date: '2026-10-20T10:30', price: 10, qty: 300, fee: 8, lotId: 'demo-3', note: '第三格 · 部分卖出' },
    { id: 'demo-5', code: 'DEMO-B', name: '示例 ETF', side: 'buy', date: '2026-10-22T13:15', price: 3.8, qty: 1000, fee: 2, note: '初始买入' },
    { id: 'demo-6', code: 'DEMO-A', name: '示例股票', side: 'buy', date: '2026-10-26T11:10', price: 9, qty: 500, fee: 5, note: '第四格' }
  ].map(normalize);
}
