import {
  AuthEvents,
  ConnectOptions,
  Handler,
  Provider,
  SignedTx,
  SignerTx,
  TypedData,
  UserData,
} from '@waves/signer';
import { EventEmitter } from 'typed-ts-events';
import { calculateFee } from './utils';
import { TRANSACTION_TYPE } from '@waves/ts-types';

export class ProviderKeeperMobile implements Provider {
  public user: UserData | null = null;
  private _options: ConnectOptions = {
    NETWORK_BYTE: 'W'.charCodeAt(0),
    NODE_URL: 'https://nodes.wavesnodes.com',
  };
  private readonly _emitter: EventEmitter<AuthEvents> =
    new EventEmitter<AuthEvents>();

  constructor() {
    // todo wc.createClient
    // todo wc.connect if session is empty
  }

  public on<EVENT extends keyof AuthEvents>(
    event: EVENT,
    handler: Handler<AuthEvents[EVENT]>
  ): Provider {
    this._emitter.on(event, handler);

    return this;
  }

  public once<EVENT extends keyof AuthEvents>(
    event: EVENT,
    handler: Handler<AuthEvents[EVENT]>
  ): Provider {
    this._emitter.once(event, handler);

    return this;
  }

  public off<EVENT extends keyof AuthEvents>(
    event: EVENT,
    handler: Handler<AuthEvents[EVENT]>
  ): Provider {
    this._emitter.off(event, handler);

    return this;
  }

  public connect(options: ConnectOptions): Promise<void> {
    this._options = options;
    return Promise.resolve();
  }

  public login(): Promise<UserData> {
    return new Promise<UserData>(resolve => {
      // todo rpc.auth
      this.user = { address: '', publicKey: '' };
      resolve(this.user);
    }).then(user => {
      this._emitter.trigger('login', user);
      return user;
    });
  }

  public logout(): Promise<void> {
    return new Promise<void>(resolve => {
      // todo wc.disconnect
      resolve();
    }).then(() => {
      this.user = null;
      this._emitter.trigger('logout', void 0);
    });
  }

  public signMessage(_data?: string | number): Promise<string> {
    return Promise.reject('signMessage not supported');
  }

  public signTypedData(_data: Array<TypedData>): Promise<string> {
    return Promise.reject('signTypedData not supported');
  }

  public async sign<T extends SignerTx>(toSign: T[]): Promise<SignedTx<T>>;
  public async sign<T extends Array<SignerTx>>(
    toSign: T
  ): Promise<SignedTx<T>> {
    if (toSign.length == 1) {
      const toSignWithFee = await this._txWithFee(toSign[0]);
      // @ts-ignore
      return new Promise<SignedTx>(resolve => {
        // todo rpc.signTransaction()
        resolve(toSignWithFee as SignedTx<T>);
      });
    }

    return Promise.reject(new Error('Multiple signature not supported'));
  }

  private _publicKeyPromise(): Promise<string | undefined> {
    return new Promise<string | undefined>(resolve => {
      // todo session.accounts
      resolve(undefined);
    });
  }

  private async _txWithFee(tx: SignerTx): Promise<SignerTx> {
    return tx.type === TRANSACTION_TYPE.INVOKE_SCRIPT && !tx.fee
      ? calculateFee(this._options.NODE_URL, {
          ...tx,
          payment: tx.payment ?? [],
          senderPublicKey: await this._publicKeyPromise(),
        })
      : Promise.resolve(tx);
  }
}
