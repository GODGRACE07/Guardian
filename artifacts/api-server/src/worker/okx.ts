/**
 * Server-side OKX REST client.
 *
 * Mirrors the browser client (artifacts/guardian/src/lib/okx.ts) but uses
 * node:crypto createHmac instead of Web Crypto, so it works synchronously
 * without async/await overhead on the hot signing path.
 *
 * Signing spec: prehash = timestamp + METHOD + requestPath + body
 *               sign    = base64( HMAC-SHA256( apiSecret, prehash ) )
 */

import { createHmac } from 'node:crypto';

const OKX_BASE = 'https://www.okx.com';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OkxConnection {
  api_key: string;
  api_secret: string;
  api_passphrase: string;
  is_demo: boolean;
}

export interface AssetBalance {
  symbol: string;
  balance: number;
  usdValue: number;
  pct: number;
}

export interface PortfolioData {
  totalUsd: number;
  assets: AssetBalance[];
}

// ─── Signing ──────────────────────────────────────────────────────────────────

function sign(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('base64');
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildHeaders(
  conn: OkxConnection,
  method: string,
  requestPath: string,
  body = '',
): Record<string, string> {
  const timestamp = nowIso();
  const prehash   = timestamp + method + requestPath + body;

  const headers: Record<string, string> = {
    'OK-ACCESS-KEY':        conn.api_key,
    'OK-ACCESS-SIGN':       sign(conn.api_secret, prehash),
    'OK-ACCESS-TIMESTAMP':  timestamp,
    'OK-ACCESS-PASSPHRASE': conn.api_passphrase,
    'Content-Type':         'application/json',
  };

  // The ONLY way to target OKX's demo environment is this header with value "1".
  // Omit it entirely for live trading — "0" is NOT the same as omitting it.
  if (Boolean(conn.is_demo)) {
    headers['x-simulated-trading'] = '1';
  }

  return headers;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function parseOkxResponse(
  res: Response,
  label: string,
): Promise<unknown> {
  // OKX always returns JSON, even on errors. Parse it before checking status.
  const json = await res.json() as { code: string; msg?: string; data?: unknown };

  if (!res.ok || json.code !== '0') {
    const code = json.code ?? String(res.status);
    const msg  = json.msg  ?? `HTTP ${res.status}`;
    throw new Error(`OKX [${code}] ${label}: ${msg}`);
  }

  return json.data;
}

export async function okxGet(
  conn: OkxConnection,
  path: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const qs          = params ? '?' + new URLSearchParams(params).toString() : '';
  const requestPath = path + qs;
  const headers     = buildHeaders(conn, 'GET', requestPath);

  const res = await fetch(OKX_BASE + requestPath, { method: 'GET', headers });
  return parseOkxResponse(res, path);
}

export async function okxPost(
  conn: OkxConnection,
  path: string,
  body: unknown,
): Promise<unknown> {
  const bodyStr = JSON.stringify(body);
  const headers = buildHeaders(conn, 'POST', path, bodyStr);

  const res = await fetch(OKX_BASE + path, {
    method:  'POST',
    headers,
    body:    bodyStr,
  });
  return parseOkxResponse(res, path);
}

// ─── Portfolio fetch (mirrors browser fetchPortfolio) ─────────────────────────

export async function fetchPortfolio(conn: OkxConnection): Promise<PortfolioData> {
  const data = await okxGet(conn, '/api/v5/account/balance') as Array<{
    totalEq: string;
    // OKX detail items have no `bal` field — the actual cash balance field is
    // `cashBal`. Using `bal` always yields undefined → 0, which makes every
    // asset appear to have no balance and breaks stop-loss evaluation.
    details: Array<{ ccy: string; cashBal: string; eqUsd: string }>;
  }>;

  const account = data[0];
  if (!account) throw new Error('No account data returned by OKX.');

  const totalUsd = parseFloat(account.totalEq) || 0;

  const assets = (account.details ?? [])
    .map((d) => ({
      symbol:   d.ccy,
      balance:  parseFloat(d.cashBal) || 0,   // was d.bal — field does not exist in OKX response
      usdValue: parseFloat(d.eqUsd)   || 0,
      pct: totalUsd > 0 ? (parseFloat(d.eqUsd) / totalUsd) * 100 : 0,
    }))
    .filter((a) => a.balance > 0)             // filter on actual balance, not just USD value
    .sort((a, b) => b.usdValue - a.usdValue);

  return { totalUsd, assets };
}

// ─── Market sell ──────────────────────────────────────────────────────────────

export interface SellResult {
  orderId: string;
  clientOrderId: string;
}

/**
 * Places a market sell order for the full balance of `asset` against USDT.
 * For demo accounts, the x-simulated-trading header is included automatically.
 *
 * sz = quantity of the BASE currency to sell (e.g. BTC for BTC-USDT).
 * For spot market sells OKX accepts the base currency amount in sz.
 */
export async function placeMarketSell(
  conn: OkxConnection,
  asset: string,
  sizeUnits: number,
): Promise<SellResult> {
  // Round to 8 decimal places to avoid OKX precision errors
  const sz = sizeUnits.toFixed(8).replace(/\.?0+$/, '');

  const body = {
    instId:  `${asset}-USDT`,
    tdMode:  'cash',        // spot trading
    side:    'sell',
    ordType: 'market',
    sz,
  };

  const result = await okxPost(conn, '/api/v5/trade/order', body) as Array<{
    ordId: string;
    clOrdId: string;
    sCode: string;
    sMsg: string;
  }>;

  const order = result[0];
  if (!order) throw new Error('OKX returned no order data.');

  // Per-order status is in sCode/sMsg — "0" means the order was accepted.
  if (order.sCode !== '0') {
    throw new Error(`OKX order rejected [${order.sCode}]: ${order.sMsg}`);
  }

  return { orderId: order.ordId, clientOrderId: order.clOrdId };
}
