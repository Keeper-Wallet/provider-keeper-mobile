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
import Client, { CLIENT_EVENTS } from '@walletconnect/client';
import { PairingTypes, SessionTypes } from '@walletconnect/types';
import QRCodeModal from '@walletconnect/legacy-modal';

export class ProviderKeeperMobile implements Provider {
  public user: UserData | null = null;
  private _options: ConnectOptions = {
    NETWORK_BYTE: 'W'.charCodeAt(0),
    NODE_URL: 'https://nodes.wavesnodes.com',
  };
  private readonly _emitter: EventEmitter<AuthEvents> =
    new EventEmitter<AuthEvents>();

  protected _wcPromise: Promise<Client>;
  private _session: SessionTypes.Settled | undefined;

  constructor() {
    this._wcPromise = Client.init({
      logger: 'debug',
      relayUrl: process.env.RELAY_URL,
      projectId: process.env.PROJECT_ID,
    });
    this._wcPromise
      .then(() => this._subscribeToEvents())
      .then(() => this._checkPersistedState());
  }

  private async _subscribeToEvents() {
    let _client = await this._wcPromise;

    if (typeof _client === 'undefined') {
      throw new Error('WalletConnect is not initialized');
    }

    _client.on(
      CLIENT_EVENTS.pairing.proposal,
      async (proposal: PairingTypes.Proposal) => {
        const { uri } = proposal.signal.params;

        console.log('EVENT', 'QR Code Modal open');
        QRCodeModal.open(uri, () => {
          console.log('EVENT', 'QR Code Modal closed');
        });
      }
    );

    _client.on(CLIENT_EVENTS.pairing.created, async () => {
      console.log('EVENT', 'pairing_created');
    });

    _client.on(
      CLIENT_EVENTS.session.updated,
      (updatedSession: SessionTypes.Settled) => {
        console.log('EVENT', 'session_updated');
        this._onSessionConnected(updatedSession);
      }
    );

    _client.on(CLIENT_EVENTS.session.deleted, () => {
      console.log('EVENT', 'session_deleted');
      this._reset();
    });
  }

  private _reset() {
    this._session = undefined;
  }

  private async _checkPersistedState() {
    let _client = await this._wcPromise;

    if (typeof _client === 'undefined') {
      throw new Error('WalletConnect is not initialized');
    }

    if (typeof this._session !== 'undefined') return;

    // populates existing session to state (assume only the top one)
    if (_client.session.topics.length) {
      const _session = await _client.session.get(_client.session.topics[0]);
      this._onSessionConnected(_session);
    }
  }

  private _onSessionConnected(session: SessionTypes.Settled) {
    this._session = session;
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
    // todo wc.connect if session is empty
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
