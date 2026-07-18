// ─── EIP-1193 provider interface ─────────────────────────────────────────────

export interface EIP1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isTrust?: boolean;
  isOKExWallet?: boolean;
}

// ─── Detected wallet descriptor ──────────────────────────────────────────────

export interface DetectedWallet {
  /** Stable identifier: EIP-6963 rdns or a synthetic fallback key */
  id: string;
  name: string;
  /** data: URI (provided by EIP-6963) or an inline SVG data URI for fallbacks */
  icon: string;
  provider: EIP1193Provider;
  /** Lower = higher priority in the display list */
  priority: number;
}

// ─── EIP-6963 internal types ──────────────────────────────────────────────────

interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface EIP6963AnnounceProviderEvent extends CustomEvent {
  detail: {
    info: EIP6963ProviderInfo;
    provider: EIP1193Provider;
  };
}

// ─── Window extensions ────────────────────────────────────────────────────────

declare global {
  interface Window {
    ethereum?: EIP1193Provider & { isMetaMask?: boolean; isCoinbaseWallet?: boolean; isTrust?: boolean };
    okxwallet?: EIP1193Provider & { isOKExWallet?: boolean };
    trustwallet?: EIP1193Provider;
    coinbaseWalletExtension?: EIP1193Provider;
  }
  interface WindowEventMap {
    'eip6963:announceProvider': EIP6963AnnounceProviderEvent;
  }
}

// ─── Priority table (rdns → sort order) ──────────────────────────────────────

const RDNS_PRIORITY: Record<string, number> = {
  'com.okex.okxwallet':    0,
  'com.okxwallet':         0,
  'io.metamask':           1,
  'com.coinbase.wallet':   2,
  'com.trustwallet.app':   3,
};

function priorityFor(rdns: string): number {
  return RDNS_PRIORITY[rdns] ?? 99;
}

// ─── Fallback icons (inline SVG data URIs) ────────────────────────────────────

// OKX logo: five squares arranged in a quincunx (OKX brand pattern)
const OKX_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='18' fill='%23000'/%3E%3Crect x='18' y='18' width='26' height='26' rx='3' fill='%23fff'/%3E%3Crect x='56' y='18' width='26' height='26' rx='3' fill='%23fff'/%3E%3Crect x='37' y='37' width='26' height='26' rx='3' fill='%23fff'/%3E%3Crect x='18' y='56' width='26' height='26' rx='3' fill='%23fff'/%3E%3Crect x='56' y='56' width='26' height='26' rx='3' fill='%23fff'/%3E%3C/svg%3E";

// MetaMask: orange background, simplified fox silhouette
const METAMASK_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='18' fill='%23F6851B'/%3E%3Cpolygon points='50,15 78,30 78,55 50,85 22,55 22,30' fill='%23fff' opacity='0.9'/%3E%3Cpolygon points='50,15 78,30 64,45 50,38' fill='%23E2761B'/%3E%3Cpolygon points='22,30 50,15 50,38 36,45' fill='%23E4761B'/%3E%3Ccircle cx='50' cy='55' r='10' fill='%23F6851B'/%3E%3C/svg%3E";

// Coinbase: blue background, white circle + vertical bars
const COINBASE_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='18' fill='%230052FF'/%3E%3Ccircle cx='50' cy='50' r='28' fill='%23fff'/%3E%3Ccircle cx='50' cy='50' r='18' fill='%230052FF'/%3E%3C/svg%3E";

// Trust Wallet: dark blue, shield
const TRUST_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='18' fill='%233375BB'/%3E%3Cpath d='M50 18 L76 30 L76 54 C76 68 64 78 50 83 C36 78 24 68 24 54 L24 30 Z' fill='%23fff' opacity='0.95'/%3E%3C/svg%3E";

// Generic fallback
const GENERIC_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='18' fill='%234fd1a5'/%3E%3Ccircle cx='50' cy='50' r='28' fill='%23fff' opacity='0.2'/%3E%3Cpath d='M50 22 L62 44 L86 44 L68 58 L74 80 L50 66 L26 80 L32 58 L14 44 L38 44 Z' fill='%23fff'/%3E%3C/svg%3E";

function fallbackIconFor(provider: EIP1193Provider): string {
  if (provider.isOKExWallet) return OKX_ICON;
  if (provider.isMetaMask)   return METAMASK_ICON;
  if (provider.isCoinbaseWallet) return COINBASE_ICON;
  if (provider.isTrust)      return TRUST_ICON;
  return GENERIC_ICON;
}

// ─── EIP-6963 discovery ───────────────────────────────────────────────────────

/**
 * Listens for EIP-6963 announcements for `timeoutMs` milliseconds, then
 * resolves with everything that announced itself.
 */
function discoverEIP6963(timeoutMs = 200): Promise<DetectedWallet[]> {
  return new Promise((resolve) => {
    const found = new Map<string, DetectedWallet>(); // keyed by rdns

    const handler = (event: EIP6963AnnounceProviderEvent) => {
      const { info, provider } = event.detail;
      if (!found.has(info.rdns)) {
        found.set(info.rdns, {
          id:       info.rdns,
          name:     info.name,
          icon:     info.icon,
          provider,
          priority: priorityFor(info.rdns),
        });
      }
    };

    window.addEventListener('eip6963:announceProvider', handler);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', handler);
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detects all installed EVM wallets via EIP-6963, then adds any legacy
 * injected wallets (window.okxwallet, window.ethereum) that didn't announce
 * themselves. Returns the list sorted by priority.
 */
export async function detectWallets(): Promise<DetectedWallet[]> {
  const wallets = await discoverEIP6963();
  const knownIds = new Set(wallets.map((w) => w.id));

  // OKX Wallet — legacy injection, often announces via EIP-6963 too
  if (window.okxwallet && !knownIds.has('com.okex.okxwallet') && !knownIds.has('com.okxwallet')) {
    wallets.push({
      id:       'com.okex.okxwallet',
      name:     'OKX Wallet',
      icon:     OKX_ICON,
      provider: window.okxwallet,
      priority: 0,
    });
    knownIds.add('com.okex.okxwallet');
  }

  // MetaMask — check window.ethereum with isMetaMask flag
  if (
    window.ethereum?.isMetaMask &&
    !window.ethereum?.isCoinbaseWallet &&
    !knownIds.has('io.metamask')
  ) {
    wallets.push({
      id:       'io.metamask',
      name:     'MetaMask',
      icon:     METAMASK_ICON,
      provider: window.ethereum,
      priority: 1,
    });
    knownIds.add('io.metamask');
  }

  // Coinbase Wallet — separate extension object
  if (window.coinbaseWalletExtension && !knownIds.has('com.coinbase.wallet')) {
    wallets.push({
      id:       'com.coinbase.wallet',
      name:     'Coinbase Wallet',
      icon:     COINBASE_ICON,
      provider: window.coinbaseWalletExtension,
      priority: 2,
    });
    knownIds.add('com.coinbase.wallet');
  }

  // Trust Wallet — separate injection
  if (window.trustwallet && !knownIds.has('com.trustwallet.app')) {
    wallets.push({
      id:       'com.trustwallet.app',
      name:     'Trust Wallet',
      icon:     TRUST_ICON,
      provider: window.trustwallet,
      priority: 3,
    });
    knownIds.add('com.trustwallet.app');
  }

  // Any other EIP-1193 provider via window.ethereum that we haven't categorised
  if (
    window.ethereum &&
    !window.ethereum.isMetaMask &&
    !window.ethereum.isCoinbaseWallet &&
    !window.ethereum.isTrust &&
    !wallets.some((w) => w.provider === window.ethereum)
  ) {
    wallets.push({
      id:       'window.ethereum',
      name:     'Browser Wallet',
      icon:     fallbackIconFor(window.ethereum),
      provider: window.ethereum,
      priority: 99,
    });
  }

  return wallets.sort((a, b) => a.priority - b.priority);
}

/**
 * Requests account access from a specific provider and returns the address
 * (lowercase). Throws if the user rejects or no accounts are returned.
 */
export async function connectWallet(provider: EIP1193Provider): Promise<string> {
  const accounts = (await provider.request({
    method: 'eth_requestAccounts',
  })) as string[];

  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts returned. Please unlock your wallet.');
  }

  return accounts[0].toLowerCase();
}

/**
 * Asks the user to sign a plain-text message via personal_sign.
 * Free off-chain signature — no transaction is broadcast.
 */
export async function signMessage(
  provider: EIP1193Provider,
  address: string,
  message: string,
): Promise<string> {
  const signature = (await provider.request({
    method: 'personal_sign',
    params: [message, address],
  })) as string;

  return signature;
}

export const SIGN_IN_MESSAGE =
  'Sign in to Guardian.\n\nThis request will not trigger a blockchain transaction or cost any fees.';
