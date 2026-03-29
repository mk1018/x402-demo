import { x402Client, x402HTTPClient, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import type { Product, PurchaseResult, Receipt, LogEvent } from "shared";

interface PaymentInfo {
  success: boolean;
  payer: string;
  transaction: string;
  network: string;
}

export function createBuyer(
  privateKey: string,
  sellerBaseUrl: string,
  emitLog: (event: LogEvent) => void,
) {
  const account = privateKeyToAccount(privateKey as `0x${string}`);

  const client = new x402Client().register("eip155:84532", new ExactEvmScheme(account));
  const httpClient = new x402HTTPClient(client);

  function log(partial: Omit<LogEvent, "id" | "timestamp">) {
    emitLog({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      ...partial,
    });
  }

  async function paidFetch(url: string, options?: RequestInit): Promise<{ body: unknown }> {
    const method = options?.method || "GET";
    const reqBody = options?.body ? JSON.parse(options.body as string) : undefined;

    // 1. Send initial request
    log({ type: "request", method, url, message: `リクエスト送信: ${method} ${url}`, requestBody: reqBody });
    const firstRes = await fetch(url, options);

    // 2. If not 402, return directly
    if (firstRes.status !== 402) {
      const text = await firstRes.text();
      let body: unknown;
      try { body = JSON.parse(text); } catch { body = text; }
      log({ type: "response_200", method, url, status: firstRes.status, message: `レスポンス受信 (${firstRes.status})`, responseBody: body });
      return { body };
    }

    // 3. Received 402 — log it
    log({ type: "response_402", method, url, status: 402, message: "402 Payment Required — 支払いが必要です" });

    // 4. Parse payment requirements
    const paymentRequired = httpClient.getPaymentRequiredResponse(
      (name) => firstRes.headers.get(name),
      await firstRes.clone().json().catch(() => undefined),
    );

    // 5. Create payment payload (EIP-3009 transferWithAuthorization) & resend
    const paymentPayload = await client.createPaymentPayload(paymentRequired);
    const auth = (paymentPayload.payload as Record<string, unknown>)?.authorization as Record<string, string> | undefined;
    const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
    log({
      type: "request", method, url,
      message: `EIP-3009 署名済み — 再送: ${method} ${url}`,
      requestBody: auth ? {
        type: "EIP-3009 transferWithAuthorization",
        from: auth.from,
        to: auth.to,
        value: auth.value,
        validAfter: auth.validAfter,
        validBefore: auth.validBefore,
      } : undefined,
    });
    const headers = new Headers(options?.headers);
    for (const [k, v] of Object.entries(paymentHeaders)) {
      headers.set(k, v);
    }
    const secondRes = await fetch(url, { ...options, headers });

    if (secondRes.status === 402) {
      log({ type: "response_402", method, url, status: 402, message: "402 — 再送後も決済失敗" });
      throw new Error(`決済失敗: ${method} ${url}`);
    }

    // 7. Parse response
    const text = await secondRes.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = text; }

    // 8. Extract payment info from response
    const paymentResponseHeader = secondRes.headers.get("payment-response");
    if (paymentResponseHeader) {
      try {
        const payment = decodePaymentResponseHeader(paymentResponseHeader) as unknown as PaymentInfo;
        log({
          type: "response_200", method, url, status: 200,
          txHash: payment.transaction,
          message: `決済完了 — tx: ${payment.transaction}`,
          responseBody: { payment, data: body },
        });
      } catch {
        log({ type: "response_200", method, url, status: secondRes.status, message: `レスポンス受信 (${secondRes.status})`, responseBody: body });
      }
    } else {
      log({ type: "response_200", method, url, status: secondRes.status, message: `レスポンス受信 (${secondRes.status})`, responseBody: body });
    }

    return { body };
  }

  async function run(): Promise<void> {
    // Step 1: 商品カタログ取得（無料）
    const { body: catalog } = await paidFetch(`${sellerBaseUrl}/products`);
    const products = catalog as Product[];

    if (products.length === 0) {
      log({ type: "error", method: "GET", url: `${sellerBaseUrl}/products`, message: "商品が見つかりません" });
      return;
    }

    // Step 2: 商品を選択
    const selected = products[0];
    log({ type: "request", method: "SYSTEM", url: "", message: `「${selected.name}」を選択 — 詳細取得中（有料 $0.01）` });

    // Step 3: 商品詳細取得（有料 → 402 → 署名 → 再送）
    const { body: detailBody } = await paidFetch(`${sellerBaseUrl}/products/${selected.id}`);
    const detail = detailBody as Product;
    log({
      type: "response_200", method: "GET",
      url: `${sellerBaseUrl}/products/${selected.id}`,
      status: 200,
      message: `商品詳細取得完了: 「${detail.name}」 $${detail.price}`,
      responseBody: detail,
    });

    // オンチェーン決済確定を待機
    log({ type: "signing", method: "SYSTEM", url: "", message: "オンチェーン決済の確定を待機中..." });
    await new Promise((r) => setTimeout(r, 5000));

    // Step 4: 購入（有料 → 402 → 署名 → 再送）
    log({ type: "request", method: "SYSTEM", url: "", message: `「${detail.name}」を購入中（有料 $0.10）` });
    const { body: purchaseBody } = await paidFetch(`${sellerBaseUrl}/purchase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: detail.id, buyerAddress: account.address }),
    });
    const purchaseResult = purchaseBody as PurchaseResult;
    log({
      type: "response_200", method: "POST",
      url: `${sellerBaseUrl}/purchase`,
      status: 200,
      message: `購入完了: 領収書ID ${purchaseResult.receiptId}`,
      responseBody: purchaseResult,
    });

    // Step 5: 領収書取得（無料）
    const { body: receiptBody } = await paidFetch(`${sellerBaseUrl}/receipt/${purchaseResult.receiptId}`);
    const receipt = receiptBody as Receipt;
    log({
      type: "response_200", method: "GET",
      url: `${sellerBaseUrl}/receipt/${receipt.id}`,
      status: 200,
      message: `領収書取得完了`,
      responseBody: receipt,
    });
    log({ type: "response_200", method: "SYSTEM", url: "", status: 200, message: `フロー完了！ 領収書: ${receipt.id}` });
  }

  return { run, address: account.address };
}
