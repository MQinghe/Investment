export type Trade = {
  id: string; code: string; name: string; side: 'buy' | 'sell'; date: string;
  price: number; qty: number; fee: number; note: string; lotId: string;
};
export type Lot = Trade & { order: number; remaining: number; cost: number; remainingCost: number };
export type Sale = Trade & { gross: number; net: number; cost: number; profit: number; matches: { lotId: string; qty: number; cost: number; price: number }[] };
export type Stock = { code: string; name: string; qty: number; cost: number; realized: number; trades: number };
export type Ledger = { records: Trade[]; lots: Lot[]; sales: Sale[]; stocks: Stock[]; qty: number; cost: number; realized: number; fees: number };
