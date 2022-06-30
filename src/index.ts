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
import Client, { CLIENT_EVENTS } from '@walletconnect/client';
import { ERROR, getAppMetadata } from '@walletconnect/utils';
import type {
  PairingTypes,
  SessionTypes,
  AppMetadata,
} from '@walletconnect/types';
import QRCodeModal from '@walletconnect/legacy-modal';
import * as wavesCrypto from '@waves/ts-lib-crypto';

const lastTopicKey = `wc@2:keeper-mobile//topic:last`;

enum RpcMethod {
  signTransaction = 'waves_signTransaction',
  signTransactionPackage = 'waves_signTransactionPackage',
  signMessage = 'waves_signMessage',
  signTypedData = 'waves_signTypedData',
}

export class ProviderKeeperMobile implements Provider {
  user: UserData | null = null;

  private readonly emitter: EventEmitter<AuthEvents> =
    new EventEmitter<AuthEvents>();
  protected metadata: AppMetadata;
  protected clientPromise: Promise<Client>;
  protected connectPromise: Promise<void>;
  protected connectResolve!: () => void; // initialized in constructor
  private loginPromise: Promise<UserData> | undefined;
  private loginReject: ((err: unknown) => void) | undefined;
  private session: SessionTypes.Settled | undefined;
  private options: ConnectOptions | undefined;

  constructor(meta?: { name?: string; description?: string; icon?: string }) {
    const appMeta = getAppMetadata();
    const name = meta?.name || appMeta?.name || window.location.origin;
    const icons = meta?.icon
      ? [meta.icon]
      : appMeta?.icons && appMeta?.icons.length !== 0
      ? appMeta.icons
      : ['https://avatars.githubusercontent.com/u/96250405'];

    this.metadata = {
      name,
      description: meta?.description || window.location.origin,
      url: appMeta?.url || window.location.origin,
      icons,
    };

    this.clientPromise = Client.init({
      logger: process.env.LOG_LEVEL,
      relayUrl: process.env.RELAY_URL,
      projectId: process.env.PROJECT_ID,
    }).then(async client => {
      await this.subscribeToEvents(client);

      return client;
    });

    this.connectPromise = new Promise(resolve => {
      this.connectResolve = resolve;
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

  private onSessionConnected(session: SessionTypes.Settled) {
    this.session = session;
    this.user = this.userDataFromSession(session);
    localStorage.setItem(lastTopicKey, session.topic);
    this.emitter.trigger('login', this.user);
  }

  private onSessionDisconnected() {
    this.clear();
    this.emitter.trigger('logout', void 0);
  }

  private clear() {
    this.session = undefined;
    this.user = null;
    localStorage.removeItem(lastTopicKey);
  }

  async connect(options: ConnectOptions): Promise<void> {
    this.options = options;

    const client = await this.clientPromise;
    await this.checkPersistedState(client);

    return this.connectResolve();
  }

  private async ensureClient(): Promise<Client> {
    await this.connectPromise;
    return this.clientPromise;
  }

  private async checkPersistedState(client: Client) {
    if (typeof this.session === 'undefined') {
      if (client.session.topics.length === 0) return;

      const topic = localStorage.getItem(lastTopicKey);

      if (topic == null || !client.session.topics.includes(topic)) return;

      this.session = await client.session.get(topic);
    }

    if (
      !this.session.state.accounts.some(
        sameChainAccount(this.options!.NETWORK_BYTE)
      )
    )
      return this.clear();

    this.onSessionConnected(this.session);
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

  login(): Promise<UserData> {
    if (typeof this.loginPromise === 'undefined') {
      this.loginPromise = new Promise((resolve, reject) => {
        if (typeof this.session !== 'undefined') {
          this.onSessionConnected(this.session);
          return resolve(this.user!);
        }

        this.ensureClient().then(async client => {
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
                  methods: Object.values(RpcMethod),
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

    return this.ensureClient()
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
    await this.login();

    if (toSign.length === 1) {
      const preparedTx = await this.prepareTx(toSign[0]);
      const signedJson = await this.performRequest(
        RpcMethod.signTransaction,
        JSON.stringify(preparedTx)
      );
      const signedTx = JSON.parse(signedJson);

      return [signedTx] as SignedTx<T>;
    }

    const preparedToSign = await Promise.all(
      toSign.map(this.prepareTx.bind(this))
    );
    const signedJson = await this.performRequest(
      RpcMethod.signTransactionPackage,
      JSON.stringify(preparedToSign)
    );

    return JSON.parse(signedJson);
  }

  private async prepareTx(
    tx: SignerTx & { chainId?: number }
  ): Promise<SignerTx> {
    tx.chainId = tx.chainId || this.options!.NETWORK_BYTE;
    tx.senderPublicKey = tx.senderPublicKey || this.user!.publicKey;

    return tx;
  }

  async signMessage(data: string | number): Promise<string> {
    await this.login();

    const bytes = wavesCrypto.stringToBytes(String(data));
    const base64 = 'base64:' + wavesCrypto.base64Encode(bytes);

    return this.performRequest(RpcMethod.signMessage, JSON.stringify(base64));
  }

  async signTypedData(data: Array<TypedData>): Promise<string> {
    await this.login();

    return this.performRequest(RpcMethod.signTypedData, JSON.stringify(data));
  }

  private async performRequest(
    method: RpcMethod,
    params: string
  ): Promise<string> {
    const client = await this.ensureClient();

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
