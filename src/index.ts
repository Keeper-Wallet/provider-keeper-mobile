import { ProviderKeeperMobile } from './provider-keeper-mobile';
import { Signer } from '@waves/signer';

// @ts-ignore
window.provider = (nodeUrl?: string): Signer => {
  const signer = new Signer(
    nodeUrl ? { NODE_URL: nodeUrl, LOG_LEVEL: 'verbose' } : undefined
  );
  const mobile = new ProviderKeeperMobile();
  signer.setProvider(mobile);
  return signer;
};
