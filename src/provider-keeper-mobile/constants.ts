import provider from '../../package.json';

export enum RPC_METHODS {
  signTransaction = 'waves_signTransaction',
  signMessage = 'waves_signMessage',
  signTypedData = 'waves_signTypedData',
}
export const ALL_RPC_METHODS = Object.values(RPC_METHODS);
export const LAST_TOPIC_KEY = `wc@2:keeper:${provider.version}//topic:last`;
export const DEFAULT_METADATA = {
  name: 'Provider Keeper Mobile',
  description: 'Provider Keeper Mobile for WalletConnect',
  url: window.location.origin,
  icons: ['https://avatars.githubusercontent.com/u/96250405'],
};
