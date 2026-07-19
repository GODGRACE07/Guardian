/**
 * OKX REST API client — browser-side, signed with Web Crypto (HMAC-SHA256).
 *
 * OKX signing spec:
 *   prehash  = timestamp + method.toUpperCase() + requestPath (+ body if POST)
 *   sign     = base64( HMAC-SHA256( apiSecret, prehash ) )
 *   headers  = OK-ACCESS-KEY, OK-ACCESS-SIGN, OK-ACCESS-TIMESTAMP,
 *              OK-ACCESS-PASSPHRASE [, x-simulated-trading: 1]
 */

const OKX_BASE = 'https://www.okx.com';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OkxConnection {
  api_key: string;
  api_secret: string;
  api_passphrase: string;
  is_demo: boolean;
}

export interface AssetBalance {
  ccy: string;       // e.g. "BTC"
  bal: string;       // total balance (string from OKX)
  eqUsd: string;     // USD equivalent
}

export interface PortfolioData {
  totalUsd: number;
  assets: Array<{
    symbol: string;
    balance: number;
    usdValue: number;
    pct: number;
  }>;
}

// ─── HMAC-SHA256 via Web Crypto ───────────────────────────────────────────────

async function hmacBase64(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  // btoa from Uint8Array
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// ─── Signed fetch ─────────────────────────────────────────────────────────────

async function okxGet(
  conn: OkxConnection,
  path: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const requestPath = path + qs;
  const timestamp = new Date().toISOString(); // e.g. "2024-01-01T00:00:00.000Z"
  const prehash = timestamp + 'GET' + requestPath;
  const sign = await hmacBase64(conn.api_secret, prehash);

  const headers: Record<string, string> = {
    'OK-ACCESS-KEY': conn.api_key,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': conn.api_passphrase,
    'Content-Type': 'application/json',
  };
  if (conn.is_demo) headers['x-simulated-trading'] = '1';

  const res = await fetch(OKX_BASE + requestPath, { headers });
  if (!res.ok) throw new Error(`OKX HTTP ${res.status}`);
  const json = await res.json() as { code: string; msg?: string; data: unknown };
  if (json.code !== '0') throw new Error(json.msg ?? `OKX error code ${json.code}`);
  return json.data;
}

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Fetches the account balance and returns a parsed PortfolioData object.
 * Only includes assets with a non-zero USD equivalent.
 */
export async function fetchPortfolio(conn: OkxConnection): Promise<PortfolioData> {
  // /api/v5/account/balance returns array; first element is the account
  const data = (await okxGet(conn, '/api/v5/account/balance')) as Array<{
    totalEq: string;
    details: AssetBalance[];
  }>;

  const account = data[0];
  if (!account) throw new Error('No account data returned.');

  const totalUsd = parseFloat(account.totalEq) || 0;

  const assets = (account.details ?? [])
    .map((d) => ({
      symbol:  d.ccy,
      balance: parseFloat(d.bal)    || 0,
      usdValue: parseFloat(d.eqUsd) || 0,
      pct: totalUsd > 0 ? (parseFloat(d.eqUsd) / totalUsd) * 100 : 0,
    }))
    .filter((a) => a.usdValue > 0.001)                  // skip dust
    .sort((a, b) => b.usdValue - a.usdValue);            // largest first

  return { totalUsd, assets };
}
