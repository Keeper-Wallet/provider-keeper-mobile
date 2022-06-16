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
import { getAppMetadata } from '@walletconnect/utils';
import { PairingTypes, SessionTypes } from '@walletconnect/types';
import QRCodeModal from '@walletconnect/legacy-modal';
import { address } from '@waves/ts-lib-crypto';

export class ProviderKeeperMobile implements Provider {
  public user: UserData | null = null;

  private readonly _emitter: EventEmitter<AuthEvents> =
    new EventEmitter<AuthEvents>();
  protected _wcPromise: Promise<Client>;
  private _session: SessionTypes.Settled | undefined;
  private _options: ConnectOptions | undefined;

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
        console.log('EVENT', 'proposal', proposal);
        const { uri } = proposal.signal.params;

        QRCodeModal.open(
          uri,
          () => {
            console.log('EVENT', 'QR Code callback');
          },
          {
            mobileLinks: [
              'https://play.google.com/store/apps/details?id=app.keeper-wallet',
            ],
            desktopLinks: [],
          }
        );
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
    this.user = { address: '', publicKey: '' };
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

  public async connect(options: ConnectOptions): Promise<void> {
    this._options = options;
    return Promise.resolve();
  }

  public login(): Promise<UserData> {
    return this._wcPromise.then(_client => {
      const DEFAULT_METADATA = {
        name: 'Provider Keeper Mobile',
        description: 'Provider Keeper Mobile for WalletConnect',
        url: window.location.origin,
        icons: ['https://avatars.githubusercontent.com/u/37784886'],
      };
      const appMeta = getAppMetadata();
      const chains = ['waves:T', 'waves:W', 'waves:S'];
      const methods = ['waves_auth', 'waves_signTransaction'];

      if (
        typeof this._session !== 'undefined' &&
        this._session.state.accounts.some(
          sameChainAccount(this._options!.NETWORK_BYTE)
        )
      )
        return this._userDataFromSession(this._session);

      return _client
        .connect({
          metadata: {
            name: appMeta?.name || DEFAULT_METADATA.name,
            description: appMeta?.description || DEFAULT_METADATA.description,
            url: appMeta?.url || window.location.origin,
            icons:
              appMeta?.icons && appMeta?.icons.length !== 0
                ? appMeta.icons
                : DEFAULT_METADATA.icons,
          },
          permissions: {
            blockchain: {
              chains,
            },
            jsonrpc: {
              methods,
            },
          },
        })
        .then(session => {
          this._onSessionConnected(session);
          this.user = this._userDataFromSession(session);

          this._emitter.trigger('login', this.user);
          return this.user;
        });
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
    throw new Error('signMessage not supported');
  }

  public signTypedData(_data: Array<TypedData>): Promise<string> {
    throw new Error('signTypedData not supported');
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

    throw new Error('Multiple signature not supported');
  }

  private _publicKeyPromise(): Promise<string | undefined> {
    return new Promise<string | undefined>(resolve => {
      // todo session.accounts
      resolve(undefined);
    });
  }

  private async _txWithFee(tx: SignerTx): Promise<SignerTx> {
    return tx.type === TRANSACTION_TYPE.INVOKE_SCRIPT && !tx.fee
      ? calculateFee(this._options!.NODE_URL, {
          ...tx,
          payment: tx.payment ?? [],
          senderPublicKey: await this._publicKeyPromise(),
        })
      : Promise.resolve(tx);
  }

  private _userDataFromSession(session: SessionTypes.Settled): UserData {
    const [, networkCode, publicKey] = session.state.accounts
      .find(sameChainAccount(this._options!.NETWORK_BYTE))!
      .split(':');

    return {
      address: address(publicKey, networkCode.charCodeAt(0)),
      publicKey: publicKey,
    };
  }
}

function sameChainAccount(chainId: number) {
  return function (account: string) {
    const [ns, networkCode] = account.split(':');
    return ns === 'waves' && networkCode == String.fromCharCode(chainId);
  };
}
