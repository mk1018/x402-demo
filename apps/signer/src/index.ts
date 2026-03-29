import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  signTypedData,
  signMessage,
  getWallet,
  type WalletInfo,
  type SignResult,
  type AccountInfo,
} from "@open-wallet-standard/core";

const PORT = Number(process.env.SIGNER_PORT);
if (!PORT) {
  console.error("Error: SIGNER_PORT is required");
  process.exit(1);
}

const WALLET_NAME = process.env.OWS_WALLET_NAME;
if (!WALLET_NAME) {
  console.error("Error: OWS_WALLET_NAME is required");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/address", (_req, res, next) => {
  try {
    const wallet: WalletInfo = getWallet(WALLET_NAME);
    const evmAccount: AccountInfo | undefined = wallet.accounts.find((a) =>
      a.chainId.startsWith("eip155:"),
    );
    if (!evmAccount) {
      res.status(500).json({ error: "No EVM account found in wallet" });
      return;
    }
    res.json({ address: evmAccount.address });
  } catch (err) {
    next(err);
  }
});

app.post("/sign-typed-data", (req, res, next) => {
  const { typedData } = req.body;
  if (!typedData) {
    res.status(400).json({ error: "typedData is required" });
    return;
  }

  try {
    const parsed = typeof typedData === "string" ? JSON.parse(typedData) : typedData;
    if (parsed.types && !parsed.types.EIP712Domain && parsed.domain) {
      const domainTypes: Array<{ name: string; type: string }> = [];
      if (parsed.domain.name !== undefined) domainTypes.push({ name: "name", type: "string" });
      if (parsed.domain.version !== undefined)
        domainTypes.push({ name: "version", type: "string" });
      if (parsed.domain.chainId !== undefined)
        domainTypes.push({ name: "chainId", type: "uint256" });
      if (parsed.domain.verifyingContract !== undefined)
        domainTypes.push({ name: "verifyingContract", type: "address" });
      if (parsed.domain.salt !== undefined) domainTypes.push({ name: "salt", type: "bytes32" });
      parsed.types.EIP712Domain = domainTypes;
    }
    const json = JSON.stringify(parsed);
    console.log("[sign-typed-data] input:", json);
    const result: SignResult = signTypedData(WALLET_NAME, "evm", json);
    console.log("[sign-typed-data] result:", JSON.stringify(result));
    const sig = result.signature.startsWith("0x") ? result.signature : `0x${result.signature}`;
    res.json({ signature: sig });
  } catch (err) {
    console.error("[sign-typed-data] error:", err);
    next(err);
  }
});

app.post("/sign-message", (req, res, next) => {
  const { message } = req.body;
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    const result: SignResult = signMessage(WALLET_NAME, "evm", message);
    const sig = result.signature.startsWith("0x") ? result.signature : `0x${result.signature}`;
    res.json({ signature: sig });
  } catch (err) {
    next(err);
  }
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", wallet: WALLET_NAME });
});

app.listen(PORT, () => {
  console.log(`Signer API running on http://localhost:${PORT}`);
  console.log(`  Wallet: ${WALLET_NAME}`);
});
