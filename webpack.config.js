/* eslint @typescript-eslint/no-var-requires: "off" */
const { ProvidePlugin } = require('webpack');
const DotenvPlugin = require('dotenv-webpack');
const TerserPlugin = require('terser-webpack-plugin');
const path = require('path');

module.exports = {
  entry: './src/index.ts',
  mode: 'production',
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'babel-loader',
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    libraryTarget: 'umd',
    globalObject: 'this',
    library: 'providerKeeperMobile',
    filename: 'provider-keeper-mobile.js',
    path: path.resolve(__dirname, 'dist'),
  },
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin({ extractComments: false })],
  },
  plugins: [
    new ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
    }),
    new DotenvPlugin({ path: './.env' }),
  ],
};
