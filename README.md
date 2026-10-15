# allblu Crypto Swap Quotes for OpenClaw

A minimal, read-only OpenClaw tool plugin for retrieving estimated cross-chain cryptocurrency swap quotes from [allblu](https://www.allblu.xyz).

This repository is an implementation preview. The plugin has completed local build and validation, but should not be considered production-ready.

## Tools

### `allblu_get_quote`

Accepts canonical allblu `from_asset` and `to_asset` slugs plus a positive decimal `amount`. It returns:

- source and destination asset slugs;
- input and estimated receive amounts;
- the estimated destination-per-source exchange rate;
- minimum receive, when available;
- estimated duration and quote timestamp;
- a clean canonical allblu swap URL.

Quotes are estimates and may expire or become unavailable. `estimated_receive_amount` is the fee-inclusive estimate supplied by the existing allblu quote API; it does not include the user's separate source-chain wallet transaction fee. The plugin does not append an `amount` query parameter to swap URLs.

### `allblu_list_assets`

Takes no arguments. It returns `available`, `reason`, and an `assets` array. Each asset contains only its canonical allblu `asset_slug`, `symbol`, `name`, and human-readable `network`.

The catalog reflects assets configured for swap support by allblu; it does not guarantee that a live quote is available for every asset or pair at every moment. Live asset listing requires `GET /api/supported-assets` to be deployed on allblu.xyz. The plugin does not copy or guess allblu's internal token mapping.

## Safety boundary

This plugin only reads from allblu's public quote and supported-assets APIs. It does not:

- create swap orders;
- call swap execution endpoints;
- connect to wallets;
- request private keys or wallet addresses;
- generate deposit addresses;
- collect refund addresses;
- sign transactions;
- handle funds;
- call Chainflip directly.

All transactions take place on [allblu.xyz](https://www.allblu.xyz).

## Installation

Directly from GitHub:

```bash
openclaw plugins install git:github.com/allblu-xyz/allblu-openclaw-plugin
openclaw plugins inspect allblu-crypto-swap-quotes --runtime --json
```

For local linked development:

```bash
openclaw plugins install -l ./allblu-openclaw-plugin
```

The repository must be built and validated before either installation path is used.

## Build and validation

After dependencies are installed in a later approved phase:

```bash
npm run plugin:build
npm run plugin:validate
```

The plugin has been built and validated locally with OpenClaw 2026.10.3 and Node.js 24.16.0.

## License

MIT. See [LICENSE](./LICENSE).
