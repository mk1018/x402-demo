import "dotenv/config";
import express from "express";
import cors from "cors";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { PRODUCT_CATALOG } from "shared";
import type { PurchaseRequest, PurchaseResult, Receipt, LogEvent } from "shared";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

const PORT = Number(process.env.PORT || 4003);
const SELLER_ADDRESS = requireEnv("SELLER_ADDRESS");
const BUYER_URL = process.env.BUYER_URL || "http://localhost:4001";

const receipts = new Map<string, Receipt>();

async function emitLog(partial: Omit<LogEvent, "id" | "timestamp">) {
  const event: LogEvent = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    ...partial,
  };
  await fetch(`${BUYER_URL}/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  }).catch(() => {});
}

const app = express();
app.use(cors());

const facilitatorClient = new HTTPFacilitatorClient({
  url: "https://x402.org/facilitator",
});

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register("eip155:84532", new ExactEvmScheme())
  .onBeforeVerify(async (ctx) => {
    const from = (ctx.paymentPayload.payload as Record<string, unknown>)?.authorization
      ? ((ctx.paymentPayload.payload as Record<string, Record<string, unknown>>).authorization
          ?.from as string)
      : "unknown";
    await emitLog({
      type: "signing",
      method: "FACILITATOR",
      url: "verify",
      message: `[Facilitator] 署名検証中 — payer: ${from}`,
      requestBody: {
        scheme: ctx.requirements.scheme,
        network: ctx.requirements.network,
        amount: ctx.requirements.amount,
        asset: ctx.requirements.asset,
      },
    });
  })
  .onAfterVerify(async (ctx) => {
    await emitLog({
      type: "response_200",
      method: "FACILITATOR",
      url: "verify",
      message: `[Facilitator] 署名検証完了 — 有効: ${ctx.result.isValid}`,
      responseBody: ctx.result,
    });
  })
  .onVerifyFailure(async (ctx) => {
    await emitLog({
      type: "error",
      method: "FACILITATOR",
      url: "verify",
      message: `[Facilitator] 署名検証失敗 — ${ctx.error.message}`,
    });
  })
  .onBeforeSettle(async (ctx) => {
    await emitLog({
      type: "signing",
      method: "FACILITATOR",
      url: "settle",
      message: `[Facilitator] 決済実行中 — ${ctx.requirements.amount} (${ctx.requirements.network})`,
      requestBody: {
        scheme: ctx.requirements.scheme,
        network: ctx.requirements.network,
        amount: ctx.requirements.amount,
        payTo: ctx.requirements.payTo,
      },
    });
  })
  .onAfterSettle(async (ctx) => {
    const txHash = (ctx.result as Record<string, unknown>).transaction as string | undefined;
    await emitLog({
      type: "response_200",
      method: "FACILITATOR",
      url: "settle",
      txHash,
      message: `[Facilitator] 決済完了 — tx: ${txHash || ""}`,
      responseBody: ctx.result,
    });
  })
  .onSettleFailure(async (ctx) => {
    await emitLog({
      type: "error",
      method: "FACILITATOR",
      url: "settle",
      message: `[Facilitator] 決済失敗 — ${ctx.error.message}`,
    });
  });

app.use(
  paymentMiddleware(
    {
      "GET /products/*": {
        accepts: {
          scheme: "exact",
          price: "$0.0001",
          network: "eip155:84532",
          payTo: SELLER_ADDRESS,
        },
        description: "Product detail access",
      },
      "POST /purchase": {
        accepts: {
          scheme: "exact",
          price: "$0.001",
          network: "eip155:84532",
          payTo: SELLER_ADDRESS,
        },
        description: "Purchase product",
      },
    },
    resourceServer,
  ),
);

app.get("/products", (_req, res) => {
  const catalog = PRODUCT_CATALOG.map(({ id, name, price }) => ({ id, name, price }));
  res.json(catalog);
});

app.get("/products/:id", (req, res) => {
  const product = PRODUCT_CATALOG.find((p) => p.id === req.params.id);
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json(product);
});

app.post("/purchase", express.json(), (req, res) => {
  const { productId, buyerAddress } = req.body as PurchaseRequest;
  const product = PRODUCT_CATALOG.find((p) => p.id === productId);
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const receiptId = `rcpt-${Date.now()}`;
  const paymentResponse = req.headers["payment-response"] as string | undefined;

  const receipt: Receipt = {
    id: receiptId,
    productId: product.id,
    productName: product.name,
    price: product.price,
    buyerAddress,
    txHash: paymentResponse || undefined,
    timestamp: Date.now(),
  };
  receipts.set(receiptId, receipt);

  res.json({ success: true, receiptId, txHash: receipt.txHash } as PurchaseResult);
});

app.get("/receipt/:id", (req, res) => {
  const receipt = receipts.get(req.params.id);
  if (!receipt) {
    res.status(404).json({ error: "Receipt not found" });
    return;
  }
  res.json(receipt);
});

app.listen(PORT, () => {
  console.log(`Seller API running on http://localhost:${PORT}`);
});
