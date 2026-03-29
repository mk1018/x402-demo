import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { PRODUCT_CATALOG } from "shared";
import type { PurchaseRequest, PurchaseResult, Receipt, LogEvent } from "shared";

const receipts = new Map<string, Receipt>();

export function createSellerRouter(
  sellerAddress: string,
  emitLog: (event: LogEvent) => void,
): express.Router {
  const router = express.Router();

  function log(partial: Omit<LogEvent, "id" | "timestamp">) {
    emitLog({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      ...partial,
    });
  }

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
      log({
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
      log({
        type: "response_200",
        method: "FACILITATOR",
        url: "verify",
        message: `[Facilitator] 署名検証完了 — 有効: ${ctx.result.isValid}`,
        responseBody: ctx.result,
      });
    })
    .onVerifyFailure(async (ctx) => {
      log({
        type: "error",
        method: "FACILITATOR",
        url: "verify",
        message: `[Facilitator] 署名検証失敗 — ${ctx.error.message}`,
      });
    })
    .onBeforeSettle(async (ctx) => {
      log({
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
      log({
        type: "response_200",
        method: "FACILITATOR",
        url: "settle",
        txHash,
        message: `[Facilitator] 決済完了 — tx: ${txHash || ""}`,
        responseBody: ctx.result,
      });
    })
    .onSettleFailure(async (ctx) => {
      log({
        type: "error",
        method: "FACILITATOR",
        url: "settle",
        message: `[Facilitator] 決済失敗 — ${ctx.error.message}`,
      });
    });

  router.use(
    paymentMiddleware(
      {
        "GET /products/*": {
          accepts: {
            scheme: "exact",
            price: "$0.01",
            network: "eip155:84532",
            payTo: sellerAddress,
          },
          description: "Product detail access",
        },
        "POST /purchase": {
          accepts: {
            scheme: "exact",
            price: "$0.10",
            network: "eip155:84532",
            payTo: sellerAddress,
          },
          description: "Purchase product",
        },
      },
      resourceServer,
    ),
  );

  router.get("/products", (_req, res) => {
    const catalog = PRODUCT_CATALOG.map(({ id, name, price }) => ({
      id,
      name,
      price,
    }));
    res.json(catalog);
  });

  router.get("/products/:id", (req, res) => {
    const product = PRODUCT_CATALOG.find((p) => p.id === req.params.id);
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    res.json(product);
  });

  router.post("/purchase", express.json(), (req, res) => {
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

    const result: PurchaseResult = {
      success: true,
      receiptId,
      txHash: receipt.txHash,
    };
    res.json(result);
  });

  router.get("/receipt/:id", (req, res) => {
    const receipt = receipts.get(req.params.id);
    if (!receipt) {
      res.status(404).json({ error: "Receipt not found" });
      return;
    }
    res.json(receipt);
  });

  return router;
}
