import {
  fetchCalculateFee,
  TFeeInfo,
} from '@waves/node-api-js/cjs/api-node/transactions';
import { SignerTx } from '@waves/signer';

export function calculateFee(base: string, tx: any): Promise<SignerTx> {
  return fetchCalculateFee(base, tx)
    .then((info: TFeeInfo) => ({ ...tx, fee: info.feeAmount }))
    .catch(() => tx);
}

function networkCode(networkByte: number): string {
  return String.fromCharCode(networkByte);
}

export function chainId(networkByte: number) {
  return `waves:${networkCode(networkByte)}`;
}

export function sameChainAccount(networkByte: number) {
  return function (account: string) {
    const [ns, networkCode_] = account.split(':');
    return ns === 'waves' && networkCode_ === networkCode(networkByte);
  };
}
