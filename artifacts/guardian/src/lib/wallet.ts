// Extend Window to include the EIP-1193 provider injected by MetaMask and compatible wallets
declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

/**
 * Requests wallet access and returns the connected address (lowercase).
 * Throws if MetaMask is not installed or the user rejects the connection.
 */
export async function connectWallet(): Promise<string> {
  if (!window.ethereum) {
    throw new Error(
      'No wallet detected. Please install MetaMask to continue.',
    );
  }
  const accounts = (await window.ethereum.request({
    method: 'eth_requestAccounts',
  })) as string[];

  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts returned. Please unlock your wallet.');
  }

  return accounts[0].toLowerCase();
}

/**
 * Asks the user to sign a plain-text message via personal_sign.
 * This is a free off-chain signature — no transaction is broadcast.
 */
export async function signMessage(address: string, message: string): Promise<string> {
  if (!window.ethereum) {
    throw new Error('No wallet detected.');
  }

  // personal_sign expects (message, address) — note the reversed order vs eth_sign
  const signature = (await window.ethereum.request({
    method: 'personal_sign',
    params: [message, address],
  })) as string;

  return signature;
}

export const SIGN_IN_MESSAGE =
  'Sign in to Guardian.\n\nThis request will not trigger a blockchain transaction or cost any fees.';
