/* eslint @typescript-eslint/no-var-requires: "off" */
const { ProvidePlugin } = require('webpack');
const DotenvPlugin = require('dotenv-webpack');
const rimraf = require('rimraf');
const path = require('path');

module.exports = {
  entry: './src/index.ts',
  mode: 'production',
  devtool: 'inline-cheap-module-source-map',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'babel-loader',
      },
    ],
  },
  externals: {
    ['@waves/signer']: { root: '@waves/signer' },
    ['@waves/ts-lib-crypto']: { root: '@waves/ts-lib-crypto' },
    ['@waves/ts-types']: { root: '@waves/ts-types' },
    ['typed-ts-events']: { root: 'typed-ts-events' },
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    filename: 'index.module.js',
    path: path.resolve(__dirname, 'dist'),
  },
  plugins: [
    new ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
    }),
    new DotenvPlugin({ path: './.env.local' }),
    new (class {
      apply(compiler) {
        compiler.hooks.done.tap('Remove LICENSE', () => {
          rimraf.sync('./dist/*.LICENSE.txt');
        });
      }
    })(),
  ],
};
