import {
  base58Decode,
  base58Encode,
  base64Encode,
  createAddress,
  utf8Encode,
} from '@keeper-wallet/waves-crypto';
import QRCodeModal from '@walletconnect/qrcode-modal';
import Client from '@walletconnect/sign-client';
import type { SessionTypes } from '@walletconnect/types';
import { getAppMetadata, getSdkError } from '@walletconnect/utils';
import type {
  AuthEvents,
  ConnectOptions,
  Handler,
  Provider,
  SignedTx,
  SignerTx,
  TypedData,
  UserData,
} from '@waves/signer';
import {
  type ExchangeTransactionOrder,
  type SignedIExchangeTransactionOrder,
} from '@waves/ts-types';
import mitt from 'mitt';

const lastTopicKey = `wc@2:keeper-mobile//topic:last`;

enum RpcMethod {
  signTransaction = 'waves_signTransaction',
  signTransactionPackage = 'waves_signTransactionPackage',
  signOrder = 'waves_signOrder',
  signMessage = 'waves_signMessage',
  signTypedData = 'waves_signTypedData',
}

export class ProviderKeeperMobile implements Provider {
  user: UserData | null = null;

  protected clientPromise: Promise<Client>;
  protected connectPromise: Promise<void>;
  protected connectResolve!: () => void; // initialized in constructor
  private loginPromise: Promise<UserData> | undefined;
  private session: SessionTypes.Struct | undefined;
  private options: ConnectOptions | undefined;
  private readonly emitter = mitt<AuthEvents>();

  constructor(meta?: { name?: string; description?: string; icon?: string }) {
    const appMeta = getAppMetadata();
    const name = meta?.name || appMeta?.name || window.location.origin;
    const icons = meta?.icon
      ? [meta.icon]
      : appMeta?.icons && appMeta?.icons.length !== 0
      ? appMeta.icons
      : ['https://avatars.githubusercontent.com/u/96250405'];

    this.clientPromise = Client.init({
      projectId: '7679252f11caf1c3a9b885396d11927e',
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
    this.emitter.emit('login', this.user);
  }

  private onSessionDisconnected() {
    this.clear();
    this.emitter.emit('logout', void 0);
  }

  private clear() {
    this.loginPromise = undefined;
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
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
    const wrappedHandler: Handler<AuthEvents[EVENT]> = (...args) => {
      handler(...args);
      this.emitter.off(event, wrappedHandler);
    };

    this.emitter.on(event, wrappedHandler);

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
        const loginReject = (err: unknown) => {
          this.loginPromise = undefined;
          reject(err);
        };

        this.ensureClient()
          .then(async client => {
            if (typeof this.session !== 'undefined') {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              return resolve(this.user!);
            }

            try {
              const { uri, approval } = await client.connect({
                // pairingTopic: pairing?.topic,
                requiredNamespaces: {
                  waves: {
                    methods: Object.values(RpcMethod),
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    chains: [chainId(this.options!.NETWORK_BYTE)],
                    events: [],
                  },
                },
              });

              if (uri) {
                QRCodeModal.open(
                  uri,
                  () => loginReject(getSdkError('USER_REJECTED')),
                  {
                    mobileLinks: ['Keeper'],
                    desktopLinks: [],
                  }
                );
              }

              const session = await approval();
              this.onSessionConnected(session);
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              resolve(this.user!);
            } catch (err) {
              loginReject(err); // catch rejection
            } finally {
              QRCodeModal.close();
            }
          })
          .catch(loginReject);
      });
    }

    return this.loginPromise;
  }

  private userDataFromSession(session: SessionTypes.Struct): UserData {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const [, networkCode, publicKey] = session.namespaces.waves.accounts
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      .find(withSameChain(this.options!.NETWORK_BYTE))!
      .split(':');

    return {
      address: base58Encode(
        createAddress(base58Decode(publicKey), networkCode.charCodeAt(0))
      ),
      publicKey,
    };
  }

  logout(): Promise<void> {
    if (typeof this.session === 'undefined') {
      return Promise.resolve();
    }

    return this.ensureClient()
      .then(client =>
        client.disconnect({
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          topic: this.session!.topic,
          reason: getSdkError('USER_DISCONNECTED'),
        })
      )
      .then(() => this.onSessionDisconnected());
  }

  async sign<T extends SignerTx>(toSign: T[]): Promise<SignedTx<T>>;
  async sign<T extends SignerTx[]>(toSign: T): Promise<SignedTx<T>> {
    await this.login();

    if (toSign.length === 1) {
      const preparedTx = await this.prepareTx(toSign[0]);
      const signedTx = await this.performRequest(
        RpcMethod.signTransaction,
        preparedTx
      );

      return [signedTx] as SignedTx<T>;
    }

    const preparedToSign = await Promise.all(
      toSign.map(this.prepareTx.bind(this))
    );

    return this.performRequest(
      RpcMethod.signTransactionPackage,
      preparedToSign
    );
  }

  private async prepareTx(
    tx: SignerTx & { chainId?: number }
  ): Promise<SignerTx> {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    tx.chainId = tx.chainId || this.options!.NETWORK_BYTE;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    tx.senderPublicKey = tx.senderPublicKey || this.user!.publicKey;

    return tx;
  }

  async signOrder(
    order: ExchangeTransactionOrder
  ): Promise<SignedIExchangeTransactionOrder<ExchangeTransactionOrder>> {
    await this.login();

    return this.performRequest(RpcMethod.signOrder, order);
  }

  async signMessage(data: string | number): Promise<string> {
    await this.login();

    const bytes = utf8Encode(String(data));
    const base64 = `base64:${base64Encode(bytes)}`;

    return this.performRequest(RpcMethod.signMessage, base64);
  }

  async signTypedData(data: TypedData[]): Promise<string> {
    await this.login();

    return this.performRequest(RpcMethod.signTypedData, data);
  }

  private async performRequest<T>(
    method: RpcMethod,
    ...params: unknown[]
  ): Promise<T> {
    const client = await this.ensureClient();

    return await client.request({
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      topic: this.session!.topic,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      chainId: chainId(this.options!.NETWORK_BYTE),
      request: { method, params },
    });
  }
}

function chainId(networkByte: number) {
  return `waves:${String.fromCharCode(networkByte)}`;
}

function withSameChain(networkByte: number) {
  return (account: string) => {
    const [ns, networkCode] = account.split(':');
    return ns === 'waves' && networkCode === String.fromCharCode(networkByte);
  };
}
