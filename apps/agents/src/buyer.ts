import { x402Client, x402HTTPClient, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { toClientEvmSigner } from "@x402/evm";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import type { Product, PurchaseResult, Receipt, LogEvent } from "shared";

interface PaymentInfo {
  success: boolean;
  payer: string;
  transaction: string;
  network: string;
}

async function createSignerFromApi(signerUrl: string) {
  const addrRes = await fetch(`${signerUrl}/address`);
  const { address } = (await addrRes.json()) as { address: string };

  const signer = {
    address: address as `0x${string}`,
    async signTypedData(message: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) {
      const res = await fetch(`${signerUrl}/sign-typed-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ typedData: message }, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      });
      const json = (await res.json()) as { signature?: string; error?: string };
      if (!res.ok || json.error) {
        throw new Error(`Signer error: ${json.error ?? res.statusText}`);
      }
      if (!json.signature) {
        throw new Error(`Signer returned no signature: ${JSON.stringify(json)}`);
      }
      return json.signature as `0x${string}`;
    },
  };

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(),
  });

  return toClientEvmSigner(signer, publicClient);
}

export async function createBuyer(
  signerUrl: string,
  sellerBaseUrl: string,
  emitLog: (event: LogEvent) => void,
) {
  const signer = await createSignerFromApi(signerUrl);

  const client = new x402Client().register("eip155:84532", new ExactEvmScheme(signer));
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

    log({
      type: "request",
      method,
      url,
      message: `リクエスト送信: ${method} ${url}`,
      requestBody: reqBody,
    });
    const firstRes = await fetch(url, options);

    if (firstRes.status !== 402) {
      const text = await firstRes.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      log({
        type: "response_200",
        method,
        url,
        status: firstRes.status,
        message: `レスポンス受信 (${firstRes.status})`,
        responseBody: body,
      });
      return { body };
    }

    log({
      type: "response_402",
      method,
      url,
      status: 402,
      message: "402 Payment Required — 支払いが必要です",
    });

    const paymentRequired = httpClient.getPaymentRequiredResponse(
      (name) => firstRes.headers.get(name),
      await firstRes
        .clone()
        .json()
        .catch(() => undefined),
    );

    const paymentPayload = await client.createPaymentPayload(paymentRequired);
    const auth = (paymentPayload.payload as Record<string, unknown>)?.authorization as
      | Record<string, string>
      | undefined;
    const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
    log({
      type: "request",
      method,
      url,
      message: `EIP-3009 署名済み — 再送: ${method} ${url}`,
      requestBody: auth
        ? {
            type: "EIP-3009 transferWithAuthorization",
            from: auth.from,
            to: auth.to,
            value: auth.value,
            validAfter: auth.validAfter,
            validBefore: auth.validBefore,
          }
        : undefined,
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

    const text = await secondRes.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    const paymentResponseHeader = secondRes.headers.get("payment-response");
    if (paymentResponseHeader) {
      try {
        const payment = decodePaymentResponseHeader(
          paymentResponseHeader,
        ) as unknown as PaymentInfo;
        log({
          type: "response_200",
          method,
          url,
          status: 200,
          txHash: payment.transaction,
          message: `決済完了 — tx: ${payment.transaction}`,
          responseBody: { payment, data: body },
        });
      } catch {
        log({
          type: "response_200",
          method,
          url,
          status: secondRes.status,
          message: `レスポンス受信 (${secondRes.status})`,
          responseBody: body,
        });
      }
    } else {
      log({
        type: "response_200",
        method,
        url,
        status: secondRes.status,
        message: `レスポンス受信 (${secondRes.status})`,
        responseBody: body,
      });
    }

    return { body };
  }

  async function run(): Promise<void> {
    const { body: catalog } = await paidFetch(`${sellerBaseUrl}/products`);
    const products = catalog as Product[];

    if (products.length === 0) {
      log({
        type: "error",
        method: "GET",
        url: `${sellerBaseUrl}/products`,
        message: "商品が見つかりません",
      });
      return;
    }

    const selected = products[0];
    log({
      type: "request",
      method: "SYSTEM",
      url: "",
      message: `「${selected.name}」を選択 — 詳細取得中（有料 $0.01）`,
    });

    const { body: detailBody } = await paidFetch(`${sellerBaseUrl}/products/${selected.id}`);
    const detail = detailBody as Product;
    log({
      type: "response_200",
      method: "GET",
      url: `${sellerBaseUrl}/products/${selected.id}`,
      status: 200,
      message: `商品詳細取得完了: 「${detail.name}」 $${detail.price}`,
      responseBody: detail,
    });

    log({
      type: "signing",
      method: "SYSTEM",
      url: "",
      message: "オンチェーン決済の確定を待機中...",
    });
    await new Promise((r) => setTimeout(r, 5000));

    log({
      type: "request",
      method: "SYSTEM",
      url: "",
      message: `「${detail.name}」を購入中（有料 $0.10）`,
    });
    const { body: purchaseBody } = await paidFetch(`${sellerBaseUrl}/purchase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: detail.id, buyerAddress: signer.address }),
    });
    const purchaseResult = purchaseBody as PurchaseResult;
    log({
      type: "response_200",
      method: "POST",
      url: `${sellerBaseUrl}/purchase`,
      status: 200,
      message: `購入完了: 領収書ID ${purchaseResult.receiptId}`,
      responseBody: purchaseResult,
    });

    const { body: receiptBody } = await paidFetch(
      `${sellerBaseUrl}/receipt/${purchaseResult.receiptId}`,
    );
    const receipt = receiptBody as Receipt;
    log({
      type: "response_200",
      method: "GET",
      url: `${sellerBaseUrl}/receipt/${receipt.id}`,
      status: 200,
      message: `領収書取得完了`,
      responseBody: receipt,
    });
    log({
      type: "response_200",
      method: "SYSTEM",
      url: "",
      status: 200,
      message: `フロー完了！ 領収書: ${receipt.id}`,
    });
  }

  return { run, address: signer.address };
}
