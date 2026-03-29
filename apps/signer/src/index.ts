import "dotenv/config";
import express from "express";
import cors from "cors";
import { privateKeyToAccount } from "viem/accounts";
import * as ows from "@open-wallet-standard/core";

const PORT = Number(process.env.SIGNER_PORT);
if (!PORT) {
  console.error("Error: SIGNER_PORT is required");
  process.exit(1);
}

const API_KEY = process.env.SIGNER_API_KEY;
if (!API_KEY) {
  console.error("Error: SIGNER_API_KEY is required");
  process.exit(1);
}

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const WALLET_NAME = process.env.OWS_WALLET_NAME;

if (!PRIVATE_KEY && !WALLET_NAME) {
  console.error("Error: PRIVATE_KEY or OWS_WALLET_NAME is required");
  process.exit(1);
}

const usePrivateKey = !!PRIVATE_KEY;
const mode = usePrivateKey
  ? `env:PRIVATE_KEY (${privateKeyToAccount(PRIVATE_KEY as `0x${string}`).address})`
  : `ows:${WALLET_NAME}`;

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (req.headers["x-signer-key"] !== API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

app.get("/address", (_req, res) => {
  try {
    if (usePrivateKey) {
      res.json({ address: privateKeyToAccount(PRIVATE_KEY as `0x${string}`).address });
    } else {
      const wallet = ows.getWallet(WALLET_NAME as string);
      const evm = wallet.accounts.find((a: { chainId: string }) => a.chainId.startsWith("eip155:"));
      if (!evm) throw new Error("No EVM account found in wallet");
      res.json({ address: evm.address });
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/sign-typed-data", async (req, res) => {
  const { typedData } = req.body;
  if (!typedData) {
    res.status(400).json({ error: "typedData is required" });
    return;
  }

  try {
    const parsed = typeof typedData === "string" ? JSON.parse(typedData) : typedData;

    if (usePrivateKey) {
      const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
      const signature = await account.signTypedData({
        domain: parsed.domain,
        types: parsed.types,
        primaryType: parsed.primaryType,
        message: parsed.message,
      });
      res.json({ signature });
    } else {
      if (parsed.types && !parsed.types.EIP712Domain && parsed.domain) {
        const domainTypes: Array<{ name: string; type: string }> = [];
        if (parsed.domain.name !== undefined) domainTypes.push({ name: "name", type: "string" });
        if (parsed.domain.version !== undefined) domainTypes.push({ name: "version", type: "string" });
        if (parsed.domain.chainId !== undefined) domainTypes.push({ name: "chainId", type: "uint256" });
        if (parsed.domain.verifyingContract !== undefined) domainTypes.push({ name: "verifyingContract", type: "address" });
        if (parsed.domain.salt !== undefined) domainTypes.push({ name: "salt", type: "bytes32" });
        parsed.types.EIP712Domain = domainTypes;
      }
      const result = ows.signTypedData(WALLET_NAME as string, "evm", JSON.stringify(parsed));
      const sig = result.signature.startsWith("0x") ? result.signature : `0x${result.signature}`;
      res.json({ signature: sig });
    }
  } catch (err) {
    console.error("[sign-typed-data] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/sign-message", async (req, res) => {
  const { message } = req.body;
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    if (usePrivateKey) {
      const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
      const signature = await account.signMessage({ message });
      res.json({ signature });
    } else {
      const result = ows.signMessage(WALLET_NAME as string, "evm", message);
      const sig = result.signature.startsWith("0x") ? result.signature : `0x${result.signature}`;
      res.json({ signature: sig });
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", mode });
});

app.listen(PORT, () => {
  console.log(`Signer API running on http://localhost:${PORT}`);
  console.log(`  Mode: ${mode}`);
});
