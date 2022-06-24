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
import { TRANSACTION_TYPE } from '@waves/ts-types';
import Client, { CLIENT_EVENTS } from '@walletconnect/client';
import { ERROR, getAppMetadata } from '@walletconnect/utils';
import type {
  PairingTypes,
  SessionTypes,
  AppMetadata,
} from '@walletconnect/types';
import QRCodeModal from '@walletconnect/legacy-modal';
import * as wavesCrypto from '@waves/ts-lib-crypto';
import type { SignerTxToSignedTx } from '@waves/signer/dist/cjs/types';

enum RPC_METHODS {
  signTransaction = 'waves_signTransaction',
  signMessage = 'waves_signMessage',
  signTypedData = 'waves_signTypedData',
}
const LAST_TOPIC_KEY = `wc@2:keeper-mobile//topic:last`;

export class ProviderKeeperMobile implements Provider {
  user: UserData | null = null;

  private readonly emitter: EventEmitter<AuthEvents> =
    new EventEmitter<AuthEvents>();
  protected metadata: AppMetadata;
  protected clientPromise: Promise<Client>;
  private loginPromise: Promise<UserData> | undefined;
  private loginReject: ((err: unknown) => void) | undefined;
  private session: SessionTypes.Settled | undefined;
  private options: ConnectOptions | undefined;

  constructor(meta?: { name?: string; icon?: string }) {
    const appMeta = getAppMetadata();
    const name = meta?.name || appMeta?.name || window.location.origin;
    const icons = meta?.icon
      ? [meta.icon]
      : appMeta?.icons && appMeta?.icons.length !== 0
      ? appMeta.icons
      : ['https://avatars.githubusercontent.com/u/96250405'];

    this.metadata = {
      name,
      description: '',
      url: appMeta?.url || window.location.origin,
      icons,
    };

    this.clientPromise = Client.init({
      logger: process.env.LOG_LEVEL,
      relayUrl: process.env.RELAY_URL,
      projectId: process.env.PROJECT_ID,
    }).then(async client => {
      await this.subscribeToEvents(client);
      await this.checkPersistedState(client);

      return client;
    });
  }

  private async subscribeToEvents(client: Client) {
    client.on(
      CLIENT_EVENTS.pairing.proposal,
      async (proposal: PairingTypes.Proposal) => {
        const { uri } = proposal.signal.params;

        QRCodeModal.open(
          uri,
          () => this.loginReject!(new Error('Cancelled by user')),
          {
            mobileLinks: ['https://keeper-wallet.app'],
            desktopLinks: [],
          }
        );
      }
    );

    client.on(CLIENT_EVENTS.pairing.created, () => QRCodeModal.close());

    client.on(
      CLIENT_EVENTS.session.updated,
      (updatedSession: SessionTypes.Settled) => {
        this.onSessionConnected(updatedSession);
      }
    );

    client.on(CLIENT_EVENTS.session.deleted, () => {
      this.onSessionDisconnected();
    });
  }

  private async checkPersistedState(client: Client) {
    if (typeof client === 'undefined') {
      throw new Error('WalletConnect is not initialized');
    }

    if (typeof this.session !== 'undefined') return;

    if (client.session.topics.length === 0) {
      return;
    }

    const topic = localStorage.getItem(LAST_TOPIC_KEY);

    if (topic == null || !client.session.topics.includes(topic)) {
      return;
    }

    const session = await client.session.get(topic);
    this.onSessionConnected(session);
  }

  private onSessionConnected(session: SessionTypes.Settled) {
    this.session = session;
    this.user = this.userDataFromSession(session);
    localStorage.setItem(LAST_TOPIC_KEY, session.topic);
    this.emitter.trigger('login', this.user);
  }

  private onSessionDisconnected() {
    this.session = undefined;
    this.user = null;
    localStorage.removeItem(LAST_TOPIC_KEY);
    this.emitter.trigger('logout', void 0);
  }

  on<EVENT extends keyof AuthEvents>(
    event: EVENT,
    handler: Handler<AuthEvents[EVENT]>
  ): Provider {
    this.emitter.on(event, handler);

    return this;
  }

  once<EVENT extends keyof AuthEvents>(
    event: EVENT,
    handler: Handler<AuthEvents[EVENT]>
  ): Provider {
    this.emitter.once(event, handler);

    return this;
  }

  off<EVENT extends keyof AuthEvents>(
    event: EVENT,
    handler: Handler<AuthEvents[EVENT]>
  ): Provider {
    this.emitter.off(event, handler);

    return this;
  }

  async connect(options: ConnectOptions): Promise<void> {
    this.options = options;
    return Promise.resolve();
  }

  login(): Promise<UserData> {
    if (typeof this.loginPromise === 'undefined') {
      this.loginPromise = new Promise((resolve, reject) => {
        if (
          typeof this.session !== 'undefined' &&
          this.session.state.accounts.some(
            sameChainAccount(this.options!.NETWORK_BYTE)
          )
        ) {
          this.onSessionConnected(this.session);
          return resolve(this.user!);
        }

        this.clientPromise.then(async client => {
          this.loginReject = (err: unknown) => {
            reject(err);
            this.loginPromise = undefined;
          };

          try {
            const session = await client.connect({
              metadata: this.metadata,
              permissions: {
                blockchain: {
                  chains: [chainId(this.options!.NETWORK_BYTE)],
                },
                jsonrpc: {
                  methods: Object.values(RPC_METHODS),
                },
              },
            });

            this.onSessionConnected(session);
            resolve(this.user!);
            this.loginPromise = undefined;
          } catch (err) {
            this.loginReject(err);
          }
        });
      });
    }

    return this.loginPromise;
  }

  private userDataFromSession(session: SessionTypes.Settled): UserData {
    const [, networkCode, publicKey] = session.state.accounts
      .find(sameChainAccount(this.options!.NETWORK_BYTE))!
      .split(':');

    return {
      address: wavesCrypto.address(publicKey, networkCode.charCodeAt(0)),
      publicKey: publicKey,
    };
  }

  logout(): Promise<void> {
    if (typeof this.session === 'undefined') {
      return Promise.resolve();
    }

    return this.clientPromise
      .then(client =>
        client.disconnect({
          topic: this.session!.topic,
          reason: ERROR.USER_DISCONNECTED.format(),
        })
      )
      .then(this.onSessionDisconnected);
  }

  async sign<T extends SignerTx>(toSign: T[]): Promise<SignedTx<T>>;
  async sign<T extends Array<SignerTx>>(toSign: T): Promise<SignedTx<T>> {
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
        await this.login();

        const txWithFee = await this.prepareTx(tx);
        const signedTx = await this.signTransaction(txWithFee);

        return [signedTx] as SignedTx<T>;
      }
    }
  }

  private async prepareTx(
    tx: SignerTx & { chainId?: number }
  ): Promise<SignerTx> {
    tx.chainId = this.options!.NETWORK_BYTE;
    tx.senderPublicKey = tx.senderPublicKey || this.user!.publicKey;

    return tx;
  }

  private async signTransaction<T extends SignerTx>(
    tx: T
  ): Promise<SignerTxToSignedTx<T>> {
    const signedJson = await this.performRequest(
      RPC_METHODS.signTransaction,
      JSON.stringify(tx)
    );

    return JSON.parse(signedJson);
  }

  async signMessage(data: string | number): Promise<string> {
    await this.login();

    return await this.performRequest(
      RPC_METHODS.signMessage,
      JSON.stringify(String(data))
    );
  }

  async signTypedData(data: Array<TypedData>): Promise<string> {
    await this.login();

    return await this.performRequest(
      RPC_METHODS.signTypedData,
      JSON.stringify(data)
    );
  }

  private async performRequest(
    method: RPC_METHODS,
    params: string
  ): Promise<string> {
    const client = await this.clientPromise;

    return await client!.request({
      topic: this.session!.topic,
      chainId: chainId(this.options!.NETWORK_BYTE),
      request: { method, params },
    });
  }
}

function networkCode(networkByte: number): string {
  return String.fromCharCode(networkByte);
}

function chainId(networkByte: number) {
  return `waves:${networkCode(networkByte)}`;
}

function sameChainAccount(networkByte: number) {
  return function (account: string) {
    const [ns, networkCode_] = account.split(':');
    return ns === 'waves' && networkCode_ === networkCode(networkByte);
  };
}

export default ProviderKeeperMobile;
