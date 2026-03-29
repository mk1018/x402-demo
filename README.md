# x402 Agent Commerce Demo

エージェント間の自律的な商取引を x402 支払いプロトコルで実現するデモアプリケーション。

## 概要

- **Agent A (Buyer)**: 商品を探して自動で購入するエージェント
- **Agent B (Seller)**: x402 で保護された商品カタログ API を提供
- **Web UI**: エージェント間の通信・決済をリアルタイム表示

## セットアップ

### 前提条件

- Node.js 18+
- pnpm

### 1. 依存関係のインストール

```bash
pnpm install
```

### 2. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集して以下を設定:

```
BUYER_PRIVATE_KEY=0x...    # Base Sepolia テストネット用 EOA 秘密鍵
SELLER_ADDRESS=0x...       # 売り手の EOA アドレス（受取先）
NEXT_PUBLIC_API_URL=http://localhost:3001
```

#### テストネット用ウォレットの準備

1. MetaMask 等で新しいアカウントを2つ作成（Buyer用 / Seller用）
2. [Base Sepolia Faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet) で ETH を取得
3. [Circle USDC Faucet](https://faucet.circle.com/) で Base Sepolia USDC を取得
4. Buyer の秘密鍵を `BUYER_PRIVATE_KEY` に設定
5. Seller のアドレスを `SELLER_ADDRESS` に設定

### 3. 起動

ターミナルを2つ開いて実行:

```bash
# ターミナル1: Agent サーバー
pnpm dev:agents

# ターミナル2: Web UI
pnpm dev:web
```

### 4. デモ実行

1. ブラウザで http://localhost:3000 を開く
2. 「Start Buyer Agent」ボタンをクリック
3. エージェント間の通信・決済がリアルタイムに表示される

## アーキテクチャ

```
[Web UI (Next.js)]
    ↕ SSE
[Orchestrator Server (Express)]
    ├── Agent A (Buyer)  ── @x402/fetch ──→ Agent B API
    └── Agent B (Seller) ── @x402/express ← リクエスト
                                ↕ verify/settle
                          [x402 Facilitator]
                          (Base Sepolia testnet)
```

## ディレクトリ構成

```
├── apps/
│   ├── web/          # Next.js UI
│   └── agents/       # Express (Buyer + Seller + Orchestrator)
├── packages/
│   └── shared/       # 型定義・商品データ
└── package.json      # pnpm workspace
```

## テストネット

- ネットワーク: Base Sepolia (Chain ID: 84532)
- Explorer: https://sepolia.basescan.org
