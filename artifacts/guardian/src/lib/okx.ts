/**
 * OKX REST API client — browser-side, signed with Web Crypto (HMAC-SHA256).
 *
 * Signing spec (https://www.okx.com/docs-v5/en/#overview-rest-authentication):
 *   prehash  = timestamp + method.toUpperCase() + requestPath + body
 *   sign     = base64( HMAC-SHA256( apiSecret, prehash ) )
 *
 *   For GET requests body must be the empty string "".
 *   For POST requests body must be the exact JSON string sent.
 *
 * Required headers on every authenticated request:
 *   OK-ACCESS-KEY        — the API key
 *   OK-ACCESS-SIGN       — base64-encoded HMAC-SHA256 signature
 *   OK-ACCESS-TIMESTAMP  — same ISO-8601 timestamp used in the prehash
 *   OK-ACCESS-PASSPHRASE — the API passphrase (not the account password)
 *
 * Additional header for demo / simulated trading:
 *   x-simulated-trading: 1
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
  ccy: string;      // e.g. "BTC"
  cashBal: string;  // cash balance as string (field name in OKX API response)
  eq: string;       // total equity of the currency (includes unrealized P&L)
  eqUsd: string;    // USD equivalent as string
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

// ─── HMAC-SHA256 via Web Crypto API ──────────────────────────────────────────

async function hmacSHA256Base64(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(message));

  // Convert ArrayBuffer → base64 safely (no spread to avoid stack limit on large buffers)
  const bytes = new Uint8Array(sigBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ─── Build the ISO-8601 timestamp OKX expects ────────────────────────────────
//
// OKX requires: YYYY-MM-DDTHH:mm:ss.sssZ  (millisecond precision, UTC)
// JavaScript's Date.toISOString() produces exactly this format.
// Generate a fresh timestamp per request to avoid the 30-second expiry window.

function nowIso(): string {
  return new Date().toISOString(); // e.g. "2024-07-18T09:44:23.142Z"
}

// ─── Authenticated GET ────────────────────────────────────────────────────────

async function okxGet(
  conn: OkxConnection,
  path: string,
  params?: Record<string, string>,
): Promise<unknown> {
  // Build the full request path (with query string if any).
  // This exact string goes into both the URL and the prehash.
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const requestPath = path + qs;

  // For GET requests the body component of the prehash is always the empty string.
  const body = '';
  const timestamp = nowIso();
  const prehash = timestamp + 'GET' + requestPath + body;
  const sign = await hmacSHA256Base64(conn.api_secret, prehash);

  // Build headers — do NOT include Content-Type on GET (no body is sent).
  const headers: Record<string, string> = {
    'OK-ACCESS-KEY':        conn.api_key,
    'OK-ACCESS-SIGN':       sign,
    'OK-ACCESS-TIMESTAMP':  timestamp,
    'OK-ACCESS-PASSPHRASE': conn.api_passphrase,
  };

  // ── Demo / simulated-trading header ──────────────────────────────────────
  // OKX maintains completely separate environments for live and demo trading.
  // A demo API key sent to the live environment (or vice-versa) returns error
  // 50101 "APIKey does not match current environment."
  // The ONLY way to target the demo environment is to include this header with
  // value "1" on every authenticated request.  Omit it entirely for live
  // trading — setting it to "0" does NOT equal omitting it.
  // Coerce to boolean explicitly because Supabase may return the column value
  // as a string ("true"/"false") depending on the query path.
  if (Boolean(conn.is_demo)) {
    headers['x-simulated-trading'] = '1';
  }

  // DEV: log the full outgoing header set so we can confirm x-simulated-trading
  // is present when is_demo is true and absent when is_demo is false.
  console.debug('[okx] outgoing headers for', requestPath, {
    'OK-ACCESS-KEY':       conn.api_key.slice(0, 8) + '…',
    'OK-ACCESS-TIMESTAMP': timestamp,
    'x-simulated-trading': headers['x-simulated-trading'] ?? '(omitted)',
    is_demo_raw:           conn.is_demo,
    is_demo_coerced:       Boolean(conn.is_demo),
  });

  const res = await fetch(OKX_BASE + requestPath, { method: 'GET', headers });

  // Always try to parse the body — OKX returns JSON even on auth errors,
  // containing a useful error code and message (e.g. code "50113" = bad signature).
  let json: { code: string; msg?: string; data?: unknown } | null = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON body (shouldn't happen with OKX but handle defensively)
    throw new Error(`OKX HTTP ${res.status}: non-JSON response`);
  }

  // OKX uses code "0" for success. Any other code is an error, regardless
  // of HTTP status.
  if (!res.ok || json?.code !== '0') {
    const code = json?.code ?? String(res.status);
    const msg  = json?.msg  ?? `HTTP ${res.status}`;
    throw new Error(`OKX [${code}]: ${msg}`);
  }

  return json.data;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches the account balance from OKX and returns a parsed PortfolioData.
 * Assets with a USD equivalent < $0.001 are excluded as dust.
 * Results are sorted largest-first by USD value.
 */
export async function fetchPortfolio(conn: OkxConnection): Promise<PortfolioData> {
  const data = (await okxGet(conn, '/api/v5/account/balance')) as Array<{
    totalEq: string;
    details: AssetBalance[];
  }>;

  const account = data[0];
  if (!account) throw new Error('No account data returned by OKX.');

  const totalUsd = parseFloat(account.totalEq) || 0;

  // OKX details items use `cashBal` for the cash balance and `eqUsd` for the
  // USD equivalent.  There is NO `bal` field on detail items — using it always
  // yields undefined → 0, which filters every asset out.
  const assets = (account.details ?? [])
    .map((d) => ({
      symbol:   d.ccy,
      balance:  parseFloat(d.cashBal) || 0,
      usdValue: parseFloat(d.eqUsd)   || 0,
      pct: totalUsd > 0 ? (parseFloat(d.eqUsd) / totalUsd) * 100 : 0,
    }))
    // Show every asset with a real balance. Exclude only true zero-balance
    // entries (can appear as floating-point noise in the OKX response).
    .filter((a) => a.balance > 0)
    .sort((a, b) => b.usdValue - a.usdValue);

  console.debug('[fetchPortfolio] assets about to render:', assets);

  return { totalUsd, assets };
}
