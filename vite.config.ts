import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: './src/index.ts',
      name: 'providerKeeperMobile',
    },
    rollupOptions: {
      output: [
        {
          entryFileNames: 'index.js',
          format: 'esm',
        },
      ],
      external: [
        /@walletconnect\/sign-client/,
        /@walletconnect\/utils/,
        /@walletconnect\/types/,
        /@walletconnect\/qrcode-modal/,
        /@waves\/signer/,
        /@waves\/ts-lib-crypto/,
        /typed-ts-events/,
      ],
    },
    minify: false,
  },
});
