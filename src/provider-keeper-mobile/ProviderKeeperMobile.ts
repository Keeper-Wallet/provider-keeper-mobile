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
import { ERROR, getAppMetadata } from '@walletconnect/utils';
import { PairingTypes, SessionTypes } from '@walletconnect/types';
import QRCodeModal from '@walletconnect/legacy-modal';
import * as wavesTx from '@waves/waves-transactions';
import * as wavesCrypto from '@waves/ts-lib-crypto';
import * as wavesAuth from '@waves/waves-transactions/dist/requests/auth';

enum CHAINS {
  MAINNET = 'waves:W',
  TESTNET = 'waves:T',
  STAGENET = 'waves:S',
}
const chains = Object.values(CHAINS);

export enum WAVES_METHODS {
  WAVES_AUTH = 'waves_auth',
  WAVES_SIGN_TRANSACTION = 'waves_signTransaction',
}
const methods = Object.values(WAVES_METHODS);

export class ProviderKeeperMobile implements Provider {
  public user: UserData | null = null;

  private readonly _emitter: EventEmitter<AuthEvents> =
    new EventEmitter<AuthEvents>();
  protected _clientPromise: Promise<Client>;
  private _session: SessionTypes.Settled | undefined;
  private _options: ConnectOptions | undefined;

  constructor() {
    this._clientPromise = Client.init({
      logger: 'debug',
      relayUrl: process.env.RELAY_URL,
      projectId: process.env.PROJECT_ID,
    });
    this._clientPromise
      .then(() => this._subscribeToEvents())
      .then(() => this._checkPersistedState());
  }

  private async _subscribeToEvents() {
    let _client = await this._clientPromise;

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
    let _client = await this._clientPromise;

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
    return this._clientPromise.then(_client => {
      const DEFAULT_METADATA = {
        name: 'Provider Keeper Mobile',
        description: 'Provider Keeper Mobile for WalletConnect',
        url: window.location.origin,
        icons: ['https://avatars.githubusercontent.com/u/37784886'],
      };
      const appMeta = getAppMetadata();

      if (
        typeof this._session !== 'undefined' &&
        this._session.state.accounts.some(
          sameChainAccount(this._options!.NETWORK_BYTE)
        )
      ) {
        this.user = this._userDataFromSession(this._session);
        return this.user;
      }

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
        })
        .finally(QRCodeModal.close);
    });
  }

  public logout(): Promise<void> {
    return this._clientPromise.then(_client => {
      if (typeof this._session === 'undefined') {
        return;
      }

      return _client
        .disconnect({
          topic: this._session.topic,
          reason: ERROR.USER_DISCONNECTED.format(),
        })
        .then(() => {
          this._session = undefined;
          this.user = null;
          this._emitter.trigger('logout', void 0);
        });
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
    if (toSign.length != 1) {
      throw new Error('Multiple signature not supported');
    }

    const tx = toSign[0];

    switch (tx.type) {
      case TRANSACTION_TYPE.ISSUE:
      case TRANSACTION_TYPE.REISSUE:
      case TRANSACTION_TYPE.BURN:
      case TRANSACTION_TYPE.LEASE:
      case TRANSACTION_TYPE.EXCHANGE:
      case TRANSACTION_TYPE.CANCEL_LEASE:
      case TRANSACTION_TYPE.ALIAS:
      case TRANSACTION_TYPE.MASS_TRANSFER:
      case TRANSACTION_TYPE.DATA:
      case TRANSACTION_TYPE.SPONSORSHIP:
      case TRANSACTION_TYPE.SET_SCRIPT:
      case TRANSACTION_TYPE.SET_ASSET_SCRIPT:
      case TRANSACTION_TYPE.UPDATE_ASSET_INFO:
        throw new Error(
          'Only transfer and invoke script transactions are supported'
        );
      default: {
        const txWithFee = await this._prepareTx(tx);
        return this._signTransaction(txWithFee);
      }
    }
  }

  private async _authData(authData: { host: string; data: string }) {
    const _client = await this._clientPromise;

    const signature: string = await _client!.request({
      topic: this._session!.topic,
      chainId: wavesId(this._options!.NETWORK_BYTE),
      request: {
        method: WAVES_METHODS.WAVES_AUTH,
        params: JSON.stringify(authData),
      },
    });

    const bytes = wavesAuth.serializeAuthData(authData);
    const valid = wavesCrypto.verifySignature(
      this.user!.publicKey,
      bytes,
      signature
    );
    if (!valid) {
      throw new Error('Signature is invalid');
    }
  }

  private async _signTransaction(tx: SignerTx) {
    const _client = await this._clientPromise;

    // todo tx versioning
    const signedJson: string = await _client!.request({
      topic: this._session!.topic,
      chainId: wavesId(this._options!.NETWORK_BYTE),
      request: {
        method: WAVES_METHODS.WAVES_SIGN_TRANSACTION,
        params: JSON.stringify(tx),
      },
    });

    const signedTx = JSON.parse(signedJson);
    const signature = signedTx.proofs[0];

    const bytes = wavesTx.makeTxBytes(tx as any); // todo this for debug only
    const valid = wavesCrypto.verifySignature(
      this.user!.publicKey,
      bytes,
      signature
    );

    if (!valid) {
      throw new Error('Signature is invalid');
    }

    return signedTx;
  }

  private async _prepareTx(
    tx: SignerTx & { chainId?: number }
  ): Promise<SignerTx> {
    tx.senderPublicKey = this.user!.publicKey;
    tx.chainId = this._options!.NETWORK_BYTE;

    if (tx.fee) {
      return Promise.resolve(tx);
    }

    if (tx.type === TRANSACTION_TYPE.INVOKE_SCRIPT) {
      return calculateFee(this._options!.NODE_URL, {
        ...tx,
        payment: tx.payment ?? [],
        senderPublicKey: this.user!.publicKey,
      });
    }

    return calculateFee(this._options!.NODE_URL, {
      ...tx,
      senderPublicKey: this.user!.publicKey,
    });
  }

  private _userDataFromSession(session: SessionTypes.Settled): UserData {
    const [, networkCode, publicKey] = session.state.accounts
      .find(sameChainAccount(this._options!.NETWORK_BYTE))!
      .split(':');

    return {
      address: wavesCrypto.address(publicKey, networkCode.charCodeAt(0)),
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

function wavesId(chainId: number) {
  return `waves:${String.fromCharCode(chainId)}`;
}
