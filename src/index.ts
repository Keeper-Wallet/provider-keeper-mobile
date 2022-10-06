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
import Client from '@walletconnect/sign-client';
import { getSdkError, getAppMetadata } from '@walletconnect/utils';
import type { SessionTypes } from '@walletconnect/types';
import QRCodeModal from '@walletconnect/qrcode-modal';
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
  protected clientPromise: Promise<Client>;
  protected connectPromise: Promise<void>;
  protected connectResolve!: () => void; // initialized in constructor
  private loginPromise: Promise<UserData> | undefined;
  private loginReject: ((err: unknown) => void) | undefined;
  private session: SessionTypes.Struct | undefined;
  private options: ConnectOptions | undefined;

  constructor(meta?: { name?: string; description?: string; icon?: string }) {
    const appMeta = getAppMetadata();
    const name = meta?.name || appMeta?.name || window.location.origin;
    const icons = meta?.icon
      ? [meta.icon]
      : appMeta?.icons && appMeta?.icons.length !== 0
      ? appMeta.icons
      : ['https://avatars.githubusercontent.com/u/96250405'];
    this.clientPromise = Client.init({
      logger: process.env.LOG_LEVEL,
      relayUrl: process.env.RELAY_URL,
      projectId: process.env.PROJECT_ID,
      metadata: {
        name,
        description: meta?.description || window.location.origin,
        url: appMeta?.url || window.location.origin,
        icons,
      },
    }).then(async client => {
      await this.subscribeToEvents(client);

      return client;
    });

    this.connectPromise = new Promise(resolve => {
      this.connectResolve = resolve;
    });
  }

  private async subscribeToEvents(client: Client) {
    client.on('session_update', ({ topic, params }) => {
      const { namespaces } = params;
      const _session = client.session.get(topic);
      const updatedSession = { ..._session, namespaces };
      this.onSessionConnected(updatedSession);
    });

    client.on('session_delete', () => {
      this.onSessionDisconnected();
    });
  }

  private onSessionConnected(session: SessionTypes.Struct) {
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
      if (client.session.length === 0) return;

      const topic = localStorage.getItem(lastTopicKey);

      if (topic == null || !client.session.keys.includes(topic)) return;

      this.session = await client.session.get(topic);
    }

    if (
      !this.session.namespaces.waves.accounts.some(
        withSameChain(this.options!.NETWORK_BYTE)
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
        this.loginReject = (err: unknown) => {
          reject(err);
          this.loginPromise = undefined;
        };

        this.ensureClient()
          .then(async client => {
            if (typeof this.session !== 'undefined') {
              return resolve(this.user!);
            }

            try {
              const requiredNamespaces = {
                waves: {
                  methods: Object.values(RpcMethod),
                  chains: [chainId(this.options!.NETWORK_BYTE)],
                  events: [],
                },
              };

              const { uri, approval } = await client.connect({
                // pairingTopic: pairing?.topic,
                requiredNamespaces,
              });

              if (uri) {
                QRCodeModal.open(
                  uri,
                  () => this.loginReject!(getSdkError('USER_REJECTED')),
                  {
                    mobileLinks: ['https://keeper-wallet.app'],
                    desktopLinks: [],
                  }
                );
              }

              const session = await approval();

              this.onSessionConnected(session);
              resolve(this.user!);
              this.loginPromise = undefined;
            } catch (err) {
              reject(err); // catch rejection
            } finally {
              QRCodeModal.close();
            }
          })
          .catch(err => this.loginReject!(err));
      });
    }

    return this.loginPromise;
  }

  private userDataFromSession(session: SessionTypes.Struct): UserData {
    const [, networkCode, publicKey] = session.namespaces.waves.accounts
      .find(withSameChain(this.options!.NETWORK_BYTE))!
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
          reason: getSdkError('USER_DISCONNECTED'),
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
        preparedTx
      );
      const signedTx = JSON.parse(signedJson);

      return [signedTx] as SignedTx<T>;
    }

    const preparedToSign = await Promise.all(
      toSign.map(this.prepareTx.bind(this))
    );
    const signedJson = await this.performRequest(
      RpcMethod.signTransactionPackage,
      preparedToSign
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

    return this.performRequest(RpcMethod.signMessage, base64);
  }

  async signTypedData(data: Array<TypedData>): Promise<string> {
    await this.login();

    return this.performRequest(RpcMethod.signTypedData, data);
  }

  private async performRequest(
    method: RpcMethod,
    ...params: unknown[]
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

function withSameChain(networkByte: number) {
  return function (account: string) {
    const [ns, networkCode_] = account.split(':');
    return ns === 'waves' && networkCode_ === networkCode(networkByte);
  };
}

export default ProviderKeeperMobile;
