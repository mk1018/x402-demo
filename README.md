# x402 Agent Commerce Demo

エージェント間の自律的な商取引を x402 支払いプロトコルで実現するデモアプリケーション。

## 概要

- **Agent A (Buyer)**: 商品を探して自動で購入するエージェント
- **Agent B (Seller)**: x402 で保護された商品カタログ API を提供
- **Signer**: 秘密鍵を隔離管理し、署名 API を提供するローカルサーバー
- **Web UI**: エージェント間の通信・決済をリアルタイム表示

## セットアップ

### 前提条件

- Node.js 18+
- pnpm

### 1. 依存関係のインストール

```bash
pnpm install
```

### 2. ウォレットのセットアップ

秘密鍵は [Open Wallet Standard (OWS)](https://github.com/open-wallet-standard/core) で暗号化管理します。エージェントに秘密鍵は渡しません。

```bash
cd apps/signer
OWS_PRIVATE_KEY=<秘密鍵> npx ows wallet import --name agent-buyer --private-key --chain evm
```

#### テストネット用ウォレットの準備

1. MetaMask 等で新しいアカウントを2つ作成（Buyer用 / Seller用）
2. [Base Sepolia Faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet) で ETH を取得
3. [Circle USDC Faucet](https://faucet.circle.com/) で Base Sepolia USDC を取得
4. Buyer の秘密鍵を OWS にインポート（上記コマンド）
5. Seller のアドレスを `apps/agents/.env` の `SELLER_ADDRESS` に設定

### 3. 環境変数の設定

```bash
# apps/agents/.env
PORT=4001
SIGNER_URL=http://localhost:4002
SELLER_ADDRESS=0x...       # 売り手の EOA アドレス（受取先）

# apps/signer/.env
OWS_WALLET_NAME=agent-buyer
SIGNER_PORT=4002
```

### 4. 起動

```bash
pnpm dev
```

Signer (port 4002) → Agents (port 4001) → Web UI (port 3000) が起動します。

### 5. デモ実行

1. ブラウザで http://localhost:3000 を開く
2. 「Start Buyer Agent」ボタンをクリック
3. エージェント間の通信・決済がリアルタイムに表示される

## アーキテクチャ

```
[Web UI (Next.js)]
    ↕ SSE
[Orchestrator Server (Express)]
    ├── Agent A (Buyer)  ── @x402/fetch ──→ Agent B API
    │       ↕ sign
    │   [Signer API (OWS)]
    │   秘密鍵はここで暗号化管理
    └── Agent B (Seller) ── @x402/express ← リクエスト
                                ↕ verify/settle
                          [x402 Facilitator]
                          (Base Sepolia testnet)
```

## ディレクトリ構成

```
├── apps/
│   ├── web/          # Next.js UI
│   ├── agents/       # Express (Buyer + Seller + Orchestrator)
│   └── signer/       # 署名 API サーバー (OWS)
├── packages/
│   └── shared/       # 型定義・商品データ
└── package.json      # pnpm workspace
```

## テストネット

- ネットワーク: Base Sepolia (Chain ID: 84532)
- Explorer: https://sepolia.basescan.org
