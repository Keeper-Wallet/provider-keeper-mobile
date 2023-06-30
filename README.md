# @keeper-wallet/provider-keeper-mobile

[![npm](https://img.shields.io/npm/v/@keeper-wallet/provider-keeper-mobile?color=blue&label=%40keeper-wallet%2Fprovider-keeper-mobile&logo=npm)](https://www.npmjs.com/package/@keeper-wallet/provider-keeper-mobile)
[![""](https://badgen.net/bundlephobia/min/@keeper-wallet/provider-keeper-mobile)](https://bundlephobia.com/package/@keeper-wallet/provider-keeper-mobile)
[![""](https://badgen.net/bundlephobia/minzip/@keeper-wallet/provider-keeper-mobile)](https://bundlephobia.com/package/@keeper-wallet/provider-keeper-mobile)
[![""](https://badgen.net/bundlephobia/dependency-count/@keeper-wallet/provider-keeper-mobile)](https://bundlephobia.com/package/@keeper-wallet/provider-keeper-mobile)
[![""](https://badgen.net/bundlephobia/tree-shaking/@keeper-wallet/provider-keeper-mobile)](https://bundlephobia.com/package/@keeper-wallet/provider-keeper-mobile)

ProviderKeeperMobile implements a Signature Provider for [Signer](https://github.com/wavesplatform/signer) protocol library.

## Installation

Install using npm:

```bash
npm install @waves/signer @keeper-wallet/provider-keeper-mobile
```

or yarn

```bash
yarn add @waves/signer @keeper-wallet/provider-keeper-mobile
```

## Content Security Policy

If your dapp uses a CSP enabled server setup, you need to append Wallet Connect
endpoints for the following directives:

```
connect-src  wss://relay.walletconnect.com https://registry.walletconnect.com;
frame-src  https://verify.walletconnect.com;
```

For more information and common use cases for CSP, see the
[MDN CSP documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP).

## Usage

- #### Provider with app metadata

  You can specify application metadata used to display in Keeper Wallet.

  ```js
  import { ProviderKeeperMobile } from '@keeper-wallet/provider-keeper-mobile';

  const keeperMobile = new ProviderKeeperMobile({
    // meta: all fields are optional
    name: 'My dApp', // name of your dApp
    icon: 'https://avatars.githubusercontent.com/u/96250405', // display icon for your dApp
  });
  ```

- #### For Testnet:

  ```js
  import { Signer } from '@waves/signer';
  import { ProviderKeeperMobile } from '@keeper-wallet/provider-keeper-mobile';

  const signer = new Signer({
    // Specify URL of the node on Testnet
    NODE_URL: 'https://nodes-testnet.wavesnodes.com',
  });
  const keeperMobile = new ProviderKeeperMobile();
  signer.setProvider(keeperMobile);
  ```

- #### For Mainnet:

  ```js
  import { Signer } from '@waves/signer';
  import { ProviderKeeperMobile } from '@keeper-wallet/provider-keeper-mobile';

  const signer = new Signer();
  const keeperMobile = new ProviderKeeperMobile();
  signer.setProvider(keeperMobile);
  ```

### Basic example

Now your application is ready to work with Waves Platform. Let's test it by implementing basic functionality.

For example, we could try to authenticate user and transfer funds:

```js
const user = await signer.login();
const [transfer] = await signer
  .transfer({
    recipient: '3Myqjf1D44wR8Vko4Tr5CwSzRNo2Vg9S7u7',
    amount: 100000, // equals to 0.001 WAVES
    assetId: null, // equals to WAVES
  })
  .broadcast();
```

Or invoke some dApp:

```js
const [invoke] = await signer
  .invoke({
    dApp: '3Fb641A9hWy63K18KsBJwns64McmdEATgJd',
    fee: 1000000,
    payment: [
      {
        assetId: '73pu8pHFNpj9tmWuYjqnZ962tXzJvLGX86dxjZxGYhoK',
        amount: 7,
      },
    ],
    call: {
      function: 'foo',
      args: [
        { type: 'integer', value: 1 },
        { type: 'binary', value: 'base64:AAA=' },
        { type: 'string', value: 'foo' },
      ],
    },
  })
  .broadcast();
```

For more examples see [Signer documentation](https://github.com/wavesplatform/signer/blob/master/README.md).

default-src 'self' https://waves.exchange https://testnet.waves.exchange https://nodes-testnet.wavesnodes.com https://nodes.wavesnodes.com https://marketdata.wavesplatform.com https://swap-widget.keeper-wallet.app;img-src 'self' data: https:;font-src 'self' data: https://fonts.gstatic.com https://fonts.googleapis.com https://js.intercomcdn.com https://fonts.intercomcdn.com;style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com;script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://vk.com https://connect.facebook.net https://mc.yandex.ru https://code.jquery.com https://google.com https://www.google.com https://www.gstatic.com https://swap-widget.keeper-wallet.app https://www.youtube.com https://marketdata.wavesplatform.com https://app.intercom.io https://widget.intercom.io https://js.intercomcdn.com;connect-src 'self' https://mc.yandex.ru https://www.facebook.com https://vk.com https://www.google-analytics.com https://google.com https://www.googletagmanager.com https://www.gstatic.com https://marketdata.wavesplatform.com https://www.youtube.com wss://relay.walletconnect.com https://api.rss2json.com https://waves.exchange https://testnet.waves.exchange https://nodes-testnet.wavesnodes.com https://nodes.wavesnodes.com https://swap-widget.keeper-wallet.app https://via.intercom.io https://api.intercom.io https://api.au.intercom.io https://api.eu.intercom.io https://api-iam.intercom.io https://api-iam.eu.intercom.io https://api-iam.au.intercom.io https://api-ping.intercom.io https://nexus-websocket-a.intercom.io wss://nexus-websocket-a.intercom.io https://nexus-websocket-b.intercom.io wss://nexus-websocket-b.intercom.io https://nexus-europe-websocket.intercom.io wss://nexus-europe-websocket.intercom.io https://nexus-australia-websocket.intercom.io wss://nexus-australia-websocket.intercom.io https://uploads.intercomcdn.com https://uploads.intercomcdn.eu https://uploads.au.intercomcdn.com https://uploads.intercomusercontent.com https://registry.walletconnect.com/api/v2/wallets;form-action https://intercom.help https://api-iam.intercom.io https://api-iam.eu.intercom.io https://api-iam.au.intercom.io ;media-src https://js.intercomcdn.com;frame-src 'self' https://www.youtube.com https://youtube.com https://www.google.com https://swap-widget.keeper-wallet.app https://waves.exchange/ https://verify.walletconnect.com/;script-src-attr 'self' 'unsafe-inline';base-uri 'self';block-all-mixed-content;frame-ancestors 'self';object-src 'none';upgrade-insecure-requests
