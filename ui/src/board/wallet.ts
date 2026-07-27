/**
 * Midnight wallet (Lace / 1AM) connector.
 *
 * Uses the DApp Connector API that the wallet extension injects at
 * `window.midnight.*`. Typed locally rather than pulled from
 * `@midnight-ntwrk/dapp-connector-api` so the web bundle stays small and the
 * page still loads for visitors who have no wallet installed.
 */

import type { WalletInfo } from './types';

/** The connector API version this dApp is built against. */
export const COMPATIBLE_CONNECTOR_API_VERSION = '4';

type ConnectedWalletAPI = {
  getConnectionStatus(): Promise<unknown>;
  getConfiguration(): Promise<{
    indexerUri: string;
    indexerWsUri: string;
    proverServerUri?: string;
    networkId?: string;
  }>;
  getShieldedAddresses(): Promise<{
    shieldedCoinPublicKey: string;
    shieldedEncryptionPublicKey: string;
  }>;
  balanceUnsealedTransaction(tx: string): Promise<{ tx: string }>;
  submitTransaction(tx: string): Promise<string>;
};

type InitialWalletAPI = {
  apiVersion: string;
  name?: string;
  connect(networkId: string): Promise<ConnectedWalletAPI>;
};

declare global {
  interface Window {
    midnight?: Record<string, unknown>;
  }
}

export type WalletDetection =
  | { readonly status: 'unavailable' }
  | { readonly status: 'available'; readonly key: string; readonly api: InitialWalletAPI };

/** Look for an injected wallet whose connector API major version we support. */
export const detectWallet = (): WalletDetection => {
  if (typeof window === 'undefined' || !window.midnight) return { status: 'unavailable' };

  for (const [key, candidate] of Object.entries(window.midnight)) {
    if (
      candidate &&
      typeof candidate === 'object' &&
      'apiVersion' in candidate &&
      typeof (candidate as InitialWalletAPI).apiVersion === 'string' &&
      typeof (candidate as InitialWalletAPI).connect === 'function' &&
      (candidate as InitialWalletAPI).apiVersion.split('.')[0] === COMPATIBLE_CONNECTOR_API_VERSION
    ) {
      return { status: 'available', key, api: candidate as InitialWalletAPI };
    }
  }
  return { status: 'unavailable' };
};

export class WalletNotFoundError extends Error {
  constructor() {
    super(
      'No compatible Midnight wallet found. Install the Lace Midnight Preview or 1AM wallet extension, then reload.',
    );
    this.name = 'WalletNotFoundError';
  }
}

/**
 * Ask the extension for authorization and return the connected API plus a
 * display-friendly summary. Throws if the user rejects or no wallet exists.
 */
export const connectWallet = async (
  networkId: string,
): Promise<{ api: ConnectedWalletAPI; info: WalletInfo }> => {
  const detection = detectWallet();
  if (detection.status === 'unavailable') throw new WalletNotFoundError();

  const connected = await detection.api.connect(networkId);
  const addresses = await connected.getShieldedAddresses();

  return {
    api: connected,
    info: {
      name: detection.api.name ?? detection.key,
      apiVersion: detection.api.apiVersion,
      address: addresses.shieldedCoinPublicKey,
    },
  };
};

/** Is a local proof server reachable? Required for any real circuit call. */
export const isProofServerReachable = async (url: string): Promise<boolean> => {
  try {
    await fetch(url, { method: 'GET', signal: AbortSignal.timeout(2500) });
    return true;
  } catch {
    return false;
  }
};
