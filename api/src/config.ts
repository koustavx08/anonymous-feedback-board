/**
 * Network endpoints for the Anonymous Feedback Board.
 *
 * Mirrors the network table used by the official Midnight scaffolds. The proof
 * server is always local: proving is what keeps your private state private, so
 * it deliberately never runs on someone else's machine.
 */

export type NetworkId = 'undeployed' | 'preview' | 'preprod';

export const NETWORK_IDS: readonly NetworkId[] = ['undeployed', 'preview', 'preprod'] as const;

export interface NetworkConfig {
  readonly networkId: NetworkId;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
  readonly faucet: string | null;
}

export const NETWORK_CONFIGS: Record<NetworkId, NetworkConfig> = {
  undeployed: {
    networkId: 'undeployed',
    indexer: 'http://127.0.0.1:8088/api/v4/graphql',
    indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
    node: 'ws://127.0.0.1:9944',
    proofServer: 'http://127.0.0.1:6300',
    faucet: null,
  },
  preview: {
    networkId: 'preview',
    indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
    indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    node: 'https://rpc.preview.midnight.network',
    proofServer: 'http://127.0.0.1:6300',
    faucet: 'https://midnight-tmnight-preview.nethermind.dev',
  },
  preprod: {
    networkId: 'preprod',
    indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    node: 'https://rpc.preprod.midnight.network',
    proofServer: 'http://127.0.0.1:6300',
    faucet: 'https://midnight-tmnight-preprod.nethermind.dev',
  },
};

export const isNetworkId = (v: unknown): v is NetworkId =>
  typeof v === 'string' && (NETWORK_IDS as readonly string[]).includes(v);

/**
 * Environment overrides for the endpoints above.
 *
 * The public Midnight endpoints are rate-limited and can be slow to sync. Point
 * these at a hosted indexer/node provider (Blockfrost, for example) to speed
 * that up.
 *
 * Provider URLs usually embed an API key, so keep them in `.env` — which is
 * gitignored — and never commit them.
 *
 *   MIDNIGHT_INDEXER_URL=https://<host>/api/v0?project_id=<key>
 *   MIDNIGHT_INDEXER_WS_URL=wss://<host>/api/v0/ws?project_id=<key>
 *   MIDNIGHT_NODE_URL=https://rpc.<host>?project_id=<key>
 *   MIDNIGHT_PROOF_SERVER_URL=http://127.0.0.1:6300
 */
const ENV_OVERRIDES: ReadonlyArray<readonly [keyof NetworkConfig, string]> = [
  ['indexer', 'MIDNIGHT_INDEXER_URL'],
  ['indexerWS', 'MIDNIGHT_INDEXER_WS_URL'],
  ['node', 'MIDNIGHT_NODE_URL'],
  ['proofServer', 'MIDNIGHT_PROOF_SERVER_URL'],
  ['faucet', 'MIDNIGHT_FAUCET_URL'],
];

/** Read the environment in a way that also works in the browser bundle. */
const readEnv = (name: string): string | undefined => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name]?.trim() || undefined;
};

/**
 * Network config for `network`, with any environment overrides applied.
 * Prefer this over indexing {@link NETWORK_CONFIGS} directly.
 */
export const resolveNetworkConfig = (network: NetworkId): NetworkConfig => {
  const base = NETWORK_CONFIGS[network];
  const resolved: Record<string, unknown> = { ...base };
  for (const [field, varName] of ENV_OVERRIDES) {
    const value = readEnv(varName);
    if (value) resolved[field] = value;
  }
  return resolved as unknown as NetworkConfig;
};

/** Which endpoints were overridden, for logging without leaking key material. */
export const describeOverrides = (): string[] =>
  ENV_OVERRIDES.filter(([, varName]) => readEnv(varName) !== undefined).map(([field]) => String(field));

/**
 * Address of the deployed feedback board.
 *
 * Left as a placeholder on purpose — deployment is a manual step (see the
 * "Manual Deployment" section of the README). Set CONTRACT_ADDRESS in your
 * environment, or replace the placeholder after you deploy.
 */
export const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS ?? '<YOUR_DEPLOYED_CONTRACT_ADDRESS>';

export const isContractAddressConfigured = (address: string = CONTRACT_ADDRESS): boolean =>
  address.length > 0 && !address.startsWith('<');
