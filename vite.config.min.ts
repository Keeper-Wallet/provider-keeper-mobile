import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    global: 'globalThis',
  },
  build: {
    lib: {
      entry: './src/index.ts',
      name: 'providerKeeperMobile',
    },
    rollupOptions: {
      output: [
        {
          entryFileNames: 'provider-keeper-mobile.umd.js',
          format: 'umd',
          exports: 'named',
        },
      ],
    },
    emptyOutDir: false,
  },
});
