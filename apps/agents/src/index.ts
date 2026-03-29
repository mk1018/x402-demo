import "dotenv/config";
import express from "express";
import cors from "cors";
import { createSellerRouter } from "./seller.js";
import { createBuyer } from "./buyer.js";
import type { LogEvent } from "shared";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

const PORT = Number(process.env.PORT || 4001);
const BUYER_PRIVATE_KEY = requireEnv("BUYER_PRIVATE_KEY");
const SELLER_ADDRESS = requireEnv("SELLER_ADDRESS");

const app = express();
app.use(cors());

// --- SSE for real-time log streaming ---
const sseClients = new Set<express.Response>();

app.get("/events", (_req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.flushHeaders();
  res.write("data: {\"type\":\"connected\"}\n\n");
  sseClients.add(res);

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);

  _req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

function broadcast(event: LogEvent) {
  const data = JSON.stringify(event);
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`);
  }
}

// --- Mount seller API ---
const SELLER_BASE_URL = `http://localhost:${PORT}/api`;
app.use("/api", createSellerRouter(SELLER_ADDRESS, broadcast));

// --- Orchestrator: trigger buyer flow ---
let buyerRunning = false;

app.post("/start", async (_req, res) => {
  if (buyerRunning) {
    res.status(409).json({ error: "Buyer agent is already running" });
    return;
  }

  buyerRunning = true;
  res.json({ status: "started" });

  try {
    const buyer = createBuyer(BUYER_PRIVATE_KEY, SELLER_BASE_URL, broadcast);
    await buyer.run();
    broadcast({
      id: `log-${Date.now()}`,
      timestamp: Date.now(),
      type: "response_200",
      method: "SYSTEM",
      url: "",
      message: "Buyerエージェントのフローが正常に完了しました",
    });
  } catch (err: any) {
    broadcast({
      id: `log-${Date.now()}`,
      timestamp: Date.now(),
      type: "error",
      method: "SYSTEM",
      url: "",
      message: `Buyerエージェントエラー: ${err.message}`,
    });
  } finally {
    buyerRunning = false;
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", buyerRunning });
});

app.listen(PORT, () => {
  console.log(`Agent server running on http://localhost:${PORT}`);
  console.log(`  Seller API: http://localhost:${PORT}/api`);
  console.log(`  SSE events: http://localhost:${PORT}/events`);
  console.log(`  Start buyer: POST http://localhost:${PORT}/start`);
});
