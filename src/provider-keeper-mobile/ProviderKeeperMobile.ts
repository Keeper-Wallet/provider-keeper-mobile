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
import { calculateFee, chainId, sameChainAccount } from './utils';
import { DataTransactionEntry, TRANSACTION_TYPE } from '@waves/ts-types';
import Client, { CLIENT_EVENTS } from '@walletconnect/client';
import { ERROR, getAppMetadata } from '@walletconnect/utils';
import { PairingTypes, SessionTypes } from '@walletconnect/types';
import QRCodeModal from '@walletconnect/legacy-modal';
import * as wavesTx from '@waves/waves-transactions';
import * as wavesCrypto from '@waves/ts-lib-crypto';
import * as wavesCustom from '@waves/waves-transactions/dist/requests/custom-data';
import { DataTransactionDeleteRequest } from '@waves/ts-types/src/parts';
import { SignerTxToSignedTx } from '@waves/signer/dist/cjs/types';
import {
  DEFAULT_METADATA,
  LAST_TOPIC_KEY,
  ALL_RPC_METHODS,
  RPC_METHODS,
} from './constants';

export class ProviderKeeperMobile implements Provider {
  public user: UserData | null = null;

  private readonly _emitter: EventEmitter<AuthEvents> =
    new EventEmitter<AuthEvents>();
  protected _clientPromise: Promise<Client>;
  private _loginReject: ((err: Error) => void) | undefined;
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
        const { uri } = proposal.signal.params;

        QRCodeModal.open(
          uri,
          () => this._loginReject!(new Error('Cancelled by user')),
          {
            mobileLinks: ['https://keeper-wallet.app'],
            desktopLinks: [],
          }
        );
      }
    );

    _client.on(CLIENT_EVENTS.pairing.created, () => QRCodeModal.close());

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

    if (_client.session.topics.length === 0) {
      return;
    }

    const topic = localStorage.getItem(LAST_TOPIC_KEY);

    if (topic == null || !_client.session.topics.includes(topic)) {
      return;
    }

    const _session = await _client.session.get(topic);
    this._onSessionConnected(_session);
  }

  private _onSessionConnected(session: SessionTypes.Settled) {
    this._session = session;
    this.user = this._userDataFromSession(session);
    localStorage.setItem(LAST_TOPIC_KEY, session.topic);
    this._emitter.trigger('login', this.user);
  }

  private _onSessionDisconnected() {
    this._session = undefined;
    this.user = null;
    localStorage.removeItem(LAST_TOPIC_KEY);
    this._emitter.trigger('logout', void 0);
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
    return new Promise(async (resolve, reject) => {
      this._loginReject = reject;
      const _client = await this._clientPromise;

      if (
        typeof this._session !== 'undefined' &&
        this._session.state.accounts.some(
          sameChainAccount(this._options!.NETWORK_BYTE)
        )
      ) {
        this._onSessionConnected(this._session);
        return resolve(this.user!);
      }

      const appMeta = getAppMetadata();

      try {
        const session = await _client.connect({
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
              chains: [chainId(this._options!.NETWORK_BYTE)],
            },
            jsonrpc: {
              methods: ALL_RPC_METHODS,
            },
          },
        });

        this._onSessionConnected(session);
        resolve(this.user!);
      } catch (e) {
        this._loginReject(new Error('Cancelled by peer'));
      }
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

  public logout(): Promise<void> {
    return new Promise(async resolve => {
      if (typeof this._session === 'undefined') {
        return;
      }

      const _client = await this._clientPromise;
      await _client.disconnect({
        topic: this._session.topic,
        reason: ERROR.USER_DISCONNECTED.format(),
      });
      this._onSessionDisconnected();
      resolve();
    });
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
        const signedTx = await this._signTransaction(txWithFee);
        return [signedTx] as SignedTx<T>;
      }
    }
  }

  private async _prepareTx(
    tx: SignerTx & { chainId?: number }
  ): Promise<SignerTx> {
    tx.chainId = this._options!.NETWORK_BYTE;
    tx.senderPublicKey = this.user!.publicKey;

    if (tx.fee) {
      return Promise.resolve(tx);
    }

    // todo remove fee calculation
    if (tx.type === TRANSACTION_TYPE.INVOKE_SCRIPT) {
      return calculateFee(this._options!.NODE_URL, {
        ...tx,
        payment: tx.payment ?? [],
      });
    }

    return calculateFee(this._options!.NODE_URL, tx);
  }

  private async _signTransaction<T extends SignerTx>(
    tx: T
  ): Promise<SignerTxToSignedTx<T>> {
    const signedJson = await this._performRequest(
      RPC_METHODS.signTransaction,
      JSON.stringify(tx)
    );

    const signedTx = JSON.parse(signedJson);

    // todo remove signature validation, debug only
    const signature = signedTx.proofs[0];
    const bytes = wavesTx.makeTxBytes(tx as any);
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

  public async signMessage(data: string | number): Promise<string> {
    data = String(data);

    const signature: string = await this._performRequest(
      RPC_METHODS.signMessage,
      JSON.stringify(data)
    );

    // todo remove signature validation, debug only
    const bytes = wavesCustom.serializeCustomData({
      version: 1,
      binary: data,
    });
    const valid = wavesCrypto.verifySignature(
      this.user!.publicKey,
      bytes,
      signature
    );
    if (!valid) {
      throw new Error('Signature is invalid');
    }

    return signature;
  }

  public async signTypedData(data: Array<TypedData>): Promise<string> {
    const signature: string = await this._performRequest(
      RPC_METHODS.signTypedData,
      JSON.stringify(data)
    );

    // todo remove signature validation, debug only
    const bytes = wavesCustom.serializeCustomData({
      version: 2,
      data: data as Exclude<
        DataTransactionEntry,
        DataTransactionDeleteRequest
      >[],
    });
    const valid = wavesCrypto.verifySignature(
      this.user!.publicKey,
      bytes,
      signature
    );
    if (!valid) {
      throw new Error('Signature is invalid');
    }

    return signature;
  }

  private async _performRequest(
    method: RPC_METHODS,
    params: string
  ): Promise<string> {
    const _client = await this._clientPromise;

    return await _client!.request({
      topic: this._session!.topic,
      chainId: chainId(this._options!.NETWORK_BYTE),
      request: { method, params },
    });
  }
}
