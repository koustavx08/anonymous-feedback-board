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
 * Address of the deployed feedback board.
 *
 * Left as a placeholder on purpose — deployment is a manual step (see the
 * "Manual Deployment" section of the README). Set CONTRACT_ADDRESS in your
 * environment, or replace the placeholder after you deploy.
 */
export const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS ?? '<YOUR_DEPLOYED_CONTRACT_ADDRESS>';

export const isContractAddressConfigured = (address: string = CONTRACT_ADDRESS): boolean =>
  address.length > 0 && !address.startsWith('<');
