# x402 Agent Commerce Demo

エージェント間の自律的な商取引を x402 支払いプロトコルで実現するデモアプリケーション。

## 概要

- **Buyer Agent**: 商品を探して自動で購入するエージェント
- **Seller API**: x402 で保護された商品カタログ API を提供
- **Signer**: 秘密鍵を隔離管理し、署名 API を提供（APIキー認証）
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
5. Seller のアドレスを `apps/seller/.env` の `SELLER_ADDRESS` に設定

### 3. 環境変数の設定

```bash
# apps/agents/.env
PORT=4001
SIGNER_URL=http://localhost:4002
SELLER_URL=http://localhost:4003

# apps/seller/.env
PORT=4003
SELLER_ADDRESS=0x...
BUYER_URL=http://localhost:4001

# apps/signer/.env
SIGNER_PORT=4002
SIGNER_API_KEY=your-secret-api-key
OWS_WALLET_NAME=agent-buyer

# apps/web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:4001
```

### 4. 起動

```bash
pnpm dev
```

### 5. デモ実行

1. ブラウザで http://localhost:3000 を開く
2. 「デモを開始」ボタンをクリック
3. エージェント間の通信・決済がリアルタイムに表示される

## アーキテクチャ

```
[Web UI (Next.js :3000)]
    ↕ SSE
[Buyer Agent (Express :4001)]
    ├── Buyer  ── x402/fetch ──→ Seller API
    │     ↕ sign (APIキー認証)
    │  [Signer API (:4002)]
    │  秘密鍵はここで暗号化管理
    │
[Seller API (Express :4003)]
    ├── x402/express ミドルウェア
    │     ↕ verify/settle
    │  [x402 Facilitator]
    │  (Base Sepolia testnet)
    └── 商品カタログ / 購入 / 領収書
```

## ディレクトリ構成

```
├── apps/
│   ├── web/          # Next.js UI
│   ├── agents/       # Buyer Agent + Orchestrator
│   ├── seller/       # Seller API（x402保護）
│   └── signer/       # 署名 API（APIキー認証）
├── packages/
│   └── shared/       # 型定義・商品データ
└── package.json      # pnpm workspace
```

## Railway デプロイ

### 1. Railway プロジェクト作成

[Railway](https://railway.app) でプロジェクトを作成し、GitHubリポジトリを接続。

### 2. サービス追加

1つのプロジェクト内に4つのサービスを作成:

| サービス名 | Root Directory | Start Command |
|-----------|---------------|---------------|
| web | `/` | `pnpm --filter web start` |
| agents | `/` | `node apps/agents/dist/index.js` |
| seller | `/` | `node apps/seller/dist/index.js` |
| signer | `/` | `node apps/signer/dist/index.js` |

各サービスの Build Command: `pnpm install && pnpm -r build`

### 3. 環境変数

Railway の各サービスに環境変数を設定。サービス間の参照は Railway の内部URL（`${{service.url}}`）を使用:

**agents:**
- `SIGNER_URL` = `${{signer.url}}`
- `SELLER_URL` = `${{seller.url}}`

**seller:**
- `SELLER_ADDRESS` = `0x...`
- `BUYER_URL` = `${{agents.url}}`

**signer:**
- `SIGNER_PORT` = `${{PORT}}`
- `SIGNER_API_KEY` = （ランダム生成）
- `OWS_WALLET_NAME` = `agent-buyer`

**web:**
- `NEXT_PUBLIC_API_URL` = `${{agents.url}}`

### 4. デプロイ

GitHubにプッシュすると自動デプロイされます。

## テストネット

- ネットワーク: Base Sepolia (Chain ID: 84532)
- Explorer: https://sepolia.basescan.org
