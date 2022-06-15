import Client, { CLIENT_EVENTS } from '@walletconnect/client';
import { PairingTypes, SessionTypes } from '@walletconnect/types';
import QRCodeModal from '@walletconnect/legacy-modal';
import * as wavesCrypto from '@waves/ts-lib-crypto';
import * as wavesTypes from '@waves/ts-types';
import * as wavesTx from '@waves/waves-transactions';
import * as wavesAuth from '@waves/waves-transactions/dist/requests/auth';

let state: {
  client?: Client;
  session?: SessionTypes.Settled;
  pairings: string[];
  chains: string[];
  accounts: string[];
} = {
  client: undefined,
  session: undefined,
  pairings: [],
  chains: [],
  accounts: [],
};

const createClient = async () => {
  try {
    const _client = await Client.init({
      logger: 'debug',
      relayUrl: process.env.RELAY_URL,
      projectId: process.env.PROJECT_ID,
    });

    state.client = _client;
    await _subscribeToEvents(_client);
    await _checkPersistedState(_client);
  } catch (err) {
    throw err;
  }
};

const reset = () => {
  state.pairings = [];
  state.session = undefined;
  state.accounts = [];
  state.chains = [];
};

const onSessionConnected = async (_session: SessionTypes.Settled) => {
  state.session = _session;
  state.chains = _session.permissions.blockchain.chains;
  state.accounts = _session.state.accounts;
};

const _subscribeToEvents = async (_client: Client) => {
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
    state.pairings = _client.pairing.topics;
  });

  _client.on(
    CLIENT_EVENTS.session.updated,
    (updatedSession: SessionTypes.Settled) => {
      console.log('EVENT', 'session_updated');
      onSessionConnected(updatedSession);
    }
  );

  _client.on(CLIENT_EVENTS.session.deleted, () => {
    console.log('EVENT', 'session_deleted');
    reset();
  });
};

const _checkPersistedState = async (_client: Client) => {
  if (typeof _client === 'undefined') {
    throw new Error('WalletConnect is not initialized');
  }
  // populates existing pairings to state
  state.pairings = _client.pairing.topics;
  if (typeof state.session !== 'undefined') return;
  // populates existing session to state (assume only the top one)
  if (_client.session.topics.length) {
    const _session = await _client.session.get(_client.session.topics[0]);
    onSessionConnected(_session);
  }
};

const connect = async (pairing?: { topic: string }) => {
  if (typeof state.client === 'undefined') {
    throw new Error('WalletConnect is not initialized');
  }
  console.log('connect', pairing);
  try {
    const methods = ['waves_auth', 'waves_signTransaction'];

    const session = await state.client.connect({
      metadata: {
        name: 'Test App',
        description: 'Test App for WalletConnect',
        url: 'http://localhost:8080',
        icons: ['https://avatars.githubusercontent.com/u/37784886'],
      },
      pairing,
      permissions: {
        blockchain: {
          chains: ['waves:T'],
        },
        jsonrpc: {
          methods,
        },
      },
    });

    onSessionConnected(session);
  } catch (e) {
    console.error(e);
    // ignore rejection
  }

  // close modal in case it was open
  QRCodeModal.close();
};

export enum DEFAULT_WAVES_METHODS {
  WAVES_AUTH = 'waves_auth',
  WAVES_SIGN_TRANSACTION = 'waves_signTransaction',
}

const wavesRpc = {
  testAuth: async (chainId: string, publicKey: string) => {
    const host = window.location.host;
    const data = String(Date.now());
    const params = { host, data };
    const json = JSON.stringify(params);

    const signature: string = await state.client!.request({
      topic: state.session!.topic,
      chainId,
      request: {
        method: DEFAULT_WAVES_METHODS.WAVES_AUTH,
        params: json,
      },
    });

    const bytes = wavesAuth.serializeAuthData(params);
    const valid = wavesCrypto.verifySignature(publicKey, bytes, signature);
    const address = wavesCrypto.address({ publicKey });

    return {
      method: DEFAULT_WAVES_METHODS.WAVES_AUTH,
      address,
      valid,
      result: signature,
    };
  },
  testSignTransferTransaction: async (chainId: string, publicKey: string) => {
    const params = {
      senderPublicKey: publicKey,
      amount: 0,
      fee: 100000,
      type: 4,
      version: 2,
      recipient: 'alias:T:merry',
      timestamp: Date.now(),
      chainId: 84,
      attachment: '',
    };

    const defaultJson = JSON.stringify(params);
    const json = prompt('Transaction JSON', defaultJson) || defaultJson;

    const signedJson: string = await state.client!.request({
      topic: state.session!.topic,
      chainId,
      request: {
        method: DEFAULT_WAVES_METHODS.WAVES_SIGN_TRANSACTION,
        params: json,
      },
    });

    const signedTx = JSON.parse(signedJson);
    const signature = signedTx.proofs[0];

    const bytes = wavesTx.makeTxBytes(JSON.parse(json));
    const valid = wavesCrypto.verifySignature(publicKey, bytes, signature);
    const address = wavesCrypto.address({ publicKey });

    return {
      method: DEFAULT_WAVES_METHODS.WAVES_SIGN_TRANSACTION,
      address,
      valid,
      result: signature,
    };
  },
  testSignInvokeScriptTransaction: async (
    chainId: string,
    publicKey: string
  ) => {
    const params = {
      dApp: 'alias:T:merry',
      call: {
        function: 'someFunction',
        args: [],
      },
      senderPublicKey: publicKey,
      type: wavesTypes.TRANSACTION_TYPE.INVOKE_SCRIPT,
      version: 3,
    };

    const defaultJson = JSON.stringify(params);
    const json = prompt('Transaction JSON', defaultJson) || defaultJson;

    const signedJson: string = await state.client!.request({
      topic: state.session!.topic,
      chainId,
      request: {
        method: DEFAULT_WAVES_METHODS.WAVES_SIGN_TRANSACTION,
        params: json,
      },
    });

    const signedTx = JSON.parse(signedJson);
    const signature = signedTx.proofs[0];

    const bytes = wavesTx.makeTxBytes(params);
    const valid = wavesCrypto.verifySignature(publicKey, bytes, signature);
    const address = wavesCrypto.address({ publicKey });

    return {
      method: DEFAULT_WAVES_METHODS.WAVES_SIGN_TRANSACTION,
      address,
      valid,
      result: signature,
    };
  },
};

// @ts-ignore
window.api = {
  createClient,
  connect,
  state,
  wavesRpc,
};
