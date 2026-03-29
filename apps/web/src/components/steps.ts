import type { LogEvent, Step } from "./types";

export function toX402Steps(log: LogEvent): Step[] {
  const id = log.id;

  if (log.method === "FACILITATOR") {
    if (log.url === "verify") {
      const isReq = log.type === "signing";
      return [
        {
          id,
          from: isReq ? "seller" : "facilitator",
          to: isReq ? "facilitator" : "seller",
          label: isReq ? "署名検証" : "検証OK",
          detail: log.message?.replace("[Facilitator] ", ""),
          color: log.type === "error" ? "red" : "orange",
          data: log.responseBody || log.requestBody,
        },
      ];
    }
    if (log.url === "settle") {
      const isReq = log.type === "signing";
      if (isReq) {
        return [
          {
            id,
            from: "seller",
            to: "facilitator",
            label: "決済実行依頼",
            detail: log.message?.replace("[Facilitator] ", ""),
            color: "orange",
            data: log.requestBody,
          },
          {
            id: id + "-chain",
            from: "facilitator",
            to: "blockchain",
            label: "USDC送金実行",
            detail: "EIP-3009 transferWithAuthorization",
            color: "cyan",
          },
        ];
      }
      return [
        {
          id: id + "-confirmed",
          from: "blockchain",
          to: "facilitator",
          label: "トランザクション確定",
          detail: log.txHash ? `tx: ${log.txHash}` : undefined,
          color: "cyan",
          txHash: log.txHash,
        },
        {
          id,
          from: "facilitator",
          to: "seller",
          label: "決済完了",
          detail: log.message?.replace("[Facilitator] ", ""),
          color: "orange",
          data: log.responseBody,
        },
      ];
    }
    return [];
  }

  return toCommonSteps(log, "EIP-3009");
}

export function toMppSteps(log: LogEvent): Step[] {
  const id = log.id;

  if (log.type === "select_payment") {
    return [
      {
        id,
        from: "buyer",
        to: "buyer",
        label: log.message || "決済方法を選択してください",
        color: "yellow",
        isSystem: true,
        isPaymentSelect: true,
      },
    ];
  }

  if (log.method === "STRIPE402") {
    if (log.url === "select") {
      return [
        {
          id,
          from: "buyer",
          to: "buyer",
          label: log.message?.replace("[Buyer] ", "") || "決済方法選択",
          color: "purple",
          isSystem: true,
        },
      ];
    }
    if (log.url === "payment") {
      return [
        {
          id,
          from: "buyer",
          to: "buyer",
          label: log.message?.replace("[Buyer] ", "") || "",
          color: "purple",
          isSystem: true,
        },
      ];
    }
    if (log.url === "charge") {
      const isReq = log.type === "signing";
      const isCrypto = log.message?.includes("クリプト") || log.message?.includes("crypto");
      const steps: Step[] = [
        {
          id,
          from: isReq ? "seller" : "stripe",
          to: isReq ? "stripe" : "seller",
          label: isReq ? "Stripe課金" : "課金完了",
          detail: log.message?.replace("[Stripe402] ", ""),
          color: log.type === "error" ? "red" : "purple",
          data: log.responseBody || log.requestBody,
        },
      ];
      if (isReq && isCrypto) {
        steps.push({
          id: id + "-chain",
          from: "stripe",
          to: "blockchain",
          label: "ステーブルコイン送金",
          detail: "USDC on Base",
          color: "cyan",
        });
      }
      if (!isReq && isCrypto) {
        steps.unshift({
          id: id + "-confirmed",
          from: "blockchain",
          to: "stripe",
          label: "トランザクション確定",
          color: "cyan",
        });
      }
      return steps;
    }
    if (log.url === "deduct") {
      return [
        {
          id,
          from: "seller",
          to: "seller",
          label: log.message?.replace("[Stripe402] ", "") || "",
          color: "purple",
          isSystem: true,
        },
      ];
    }
    return [];
  }

  return toCommonSteps(log, "Stripe");
}

function toCommonSteps(log: LogEvent, signLabel: string): Step[] {
  const id = log.id;

  if (log.method === "SYSTEM") {
    return [
      {
        id,
        from: "buyer",
        to: "buyer",
        label: log.message || "",
        color: log.type === "error" ? "red" : "gray",
        isSystem: true,
      },
    ];
  }

  if (log.type === "request") {
    const isSigned =
      log.message?.includes(signLabel) ||
      log.message?.includes("署名済み") ||
      log.message?.includes("Stripe決済済み");
    return [
      {
        id,
        from: "buyer",
        to: "seller",
        label: isSigned
          ? `${log.method} ${log.url.replace(/^https?:\/\/[^/]+/, "")}（${signLabel}署名済み）`
          : `${log.method} ${log.url.replace(/^https?:\/\/[^/]+/, "")}`,
        color: isSigned ? "purple" : "blue",
        data: log.requestBody,
      },
    ];
  }

  if (log.type === "response_402") {
    return [
      {
        id,
        from: "seller",
        to: "buyer",
        label: "402 Payment Required",
        detail: "支払いが必要",
        color: "yellow",
      },
    ];
  }

  if (log.type === "signing") return [];

  if (log.type === "response_200") {
    return [
      {
        id,
        from: "seller",
        to: "buyer",
        label: "200 OK",
        detail: log.message,
        color: "green",
        txHash: log.txHash,
        data: log.responseBody,
      },
    ];
  }

  if (log.type === "error") {
    return [
      {
        id,
        from: "buyer",
        to: "buyer",
        label: log.message || "エラー",
        color: "red",
        isSystem: true,
      },
    ];
  }

  return [];
}
