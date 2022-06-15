import Client, { CLIENT_EVENTS } from '@walletconnect/client';
import { PairingTypes, SessionTypes } from '@walletconnect/types';
import QRCodeModal from '@walletconnect/legacy-modal';

let client;
let session;
let pairings: string[] = [];
let chains: string[] = [];
let accounts: string[] = [];

const createClient = async () => {
  try {
    const _client = await Client.init({
      logger: 'debug',
      relayUrl: process.env.RELAY_URL,
      projectId: process.env.PROJECT_ID,
    });

    client = _client;
    await _subscribeToEvents(_client);
    await _checkPersistedState(_client);
  } catch (err) {
    throw err;
  }
};

const reset = () => {
  pairings = [];
  session = undefined;
  accounts = [];
  chains = [];
};

const onSessionConnected = async (_session: SessionTypes.Settled) => {
  session = _session;
  chains = _session.permissions.blockchain.chains;
  accounts = _session.state.accounts;
  console.log(_session, chains, accounts);
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
    pairings = _client.pairing.topics;
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
  pairings = _client.pairing.topics;
  if (typeof session !== 'undefined') return;
  // populates existing session to state (assume only the top one)
  if (_client.session.topics.length) {
    const _session = await _client.session.get(_client.session.topics[0]);
    onSessionConnected(_session);
  }
};

const connect = async (pairing?: { topic: string }) => {
  if (typeof client === 'undefined') {
    throw new Error('WalletConnect is not initialized');
  }
  console.log('connect', pairing);
  try {
    const methods = ['waves_auth', 'waves_signTransaction'];

    const session = await client.connect({
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

// @ts-ignore
window.api = { createClient, connect };
