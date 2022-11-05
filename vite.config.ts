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
          entryFileNames: 'provider-keeper-mobile.cjs.js',
          format: 'cjs',
        },
      ],
      external: [
        /@walletconnect\/sign-client/,
        /@walletconnect\/utils/,
        /@walletconnect\/types/,
        /@walletconnect\/qrcode-modal/,
        /@waves\/ts-lib-crypto/,
        /typed-ts-events/,
      ],
    },
    minify: false,
  },
});
