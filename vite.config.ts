import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: './src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    sourcemap: true,
    rollupOptions: {
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
  },
});
