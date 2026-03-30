export interface Product {
  id: string;
  name: string;
  price: number;
  description?: string;
  image?: string;
}

export interface PurchaseRequest {
  productId: string;
  buyerAddress: string;
}

export interface PurchaseResult {
  success: boolean;
  receiptId: string;
  txHash?: string;
}

export interface Receipt {
  id: string;
  productId: string;
  productName: string;
  price: number;
  buyerAddress: string;
  txHash?: string;
  timestamp: number;
}

export type LogEventType =
  | "request"
  | "response_402"
  | "signing"
  | "response_200"
  | "error"
  | "phase";

export interface LogEvent {
  id: string;
  timestamp: number;
  type: LogEventType;
  method: string;
  url: string;
  status?: number;
  amount?: string;
  txHash?: string;
  message?: string;
  requestBody?: unknown;
  responseBody?: unknown;
}
