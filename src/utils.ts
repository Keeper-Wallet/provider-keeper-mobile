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
