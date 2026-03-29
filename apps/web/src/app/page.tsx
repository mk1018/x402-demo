"use client";

import { useState, useEffect, useRef } from "react";

interface LogEvent {
  id: string;
  timestamp: number;
  type: "request" | "response_402" | "signing" | "response_200" | "error";
  method: string;
  url: string;
  status?: number;
  txHash?: string;
  message?: string;
  requestBody?: unknown;
  responseBody?: unknown;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4001";

type Actor = "buyer" | "seller" | "facilitator" | "blockchain";

interface Step {
  id: string;
  from: Actor;
  to: Actor;
  label: string;
  detail?: string;
  color: string;
  txHash?: string;
  data?: unknown;
  isSystem?: boolean;
}

function toSteps(log: LogEvent): Step[] {
  const id = log.id;

  if (log.method === "FACILITATOR") {
    if (log.url === "verify") {
      const isReq = log.type === "signing";
      return [{ id, from: isReq ? "seller" : "facilitator", to: isReq ? "facilitator" : "seller", label: isReq ? "署名検証" : "検証OK", detail: log.message?.replace("[Facilitator] ", ""), color: log.type === "error" ? "red" : "orange", data: log.responseBody || log.requestBody }];
    }
    if (log.url === "settle") {
      const isReq = log.type === "signing";
      if (isReq) {
        // 決済実行: Facilitator → Blockchain
        return [
          { id, from: "seller", to: "facilitator", label: "決済実行依頼", detail: log.message?.replace("[Facilitator] ", ""), color: "orange", data: log.requestBody },
          { id: id + "-chain", from: "facilitator", to: "blockchain", label: "USDC送金実行", detail: "EIP-3009 transferWithAuthorization", color: "cyan" },
        ];
      }
      // 決済完了: Blockchain → Facilitator → Seller
      return [
        { id: id + "-confirmed", from: "blockchain", to: "facilitator", label: "トランザクション確定", detail: log.txHash ? `tx: ${log.txHash}` : undefined, color: "cyan", txHash: log.txHash },
        { id, from: "facilitator", to: "seller", label: "決済完了", detail: log.message?.replace("[Facilitator] ", ""), color: "orange", data: log.responseBody },
      ];
    }
    return [];
  }

  if (log.method === "SYSTEM") return [{ id, from: "buyer", to: "buyer", label: log.message || "", color: log.type === "error" ? "red" : "gray", isSystem: true }];

  if (log.type === "request") {
    const isSigned = log.message?.includes("EIP-3009");
    return [{ id, from: "buyer", to: "seller", label: isSigned ? `${log.method} ${log.url.replace(/.*\/api/, "/api")}（EIP-3009署名済み）` : `${log.method} ${log.url.replace(/.*\/api/, "/api")}`, color: isSigned ? "purple" : "blue", data: log.requestBody }];
  }

  if (log.type === "response_402") return [{ id, from: "seller", to: "buyer", label: "402 Payment Required", detail: "支払いが必要", color: "yellow" }];
  if (log.type === "signing") return [];
  if (log.type === "response_200") return [{ id, from: "seller", to: "buyer", label: "200 OK", detail: log.message, color: "green", txHash: log.txHash, data: log.responseBody }];
  if (log.type === "error") return [{ id, from: "buyer", to: "buyer", label: log.message || "エラー", color: "red", isSystem: true }];
  return [];
}

const CLS: Record<string, { text: string; bg: string; border: string; line: string }> = {
  blue:   { text: "text-blue-400",   bg: "bg-blue-500/10",   border: "border-blue-500/30",   line: "#3b82f6" },
  green:  { text: "text-green-400",  bg: "bg-green-500/10",  border: "border-green-500/30",  line: "#22c55e" },
  yellow: { text: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30", line: "#eab308" },
  purple: { text: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/30", line: "#a855f7" },
  orange: { text: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30", line: "#f97316" },
  red:    { text: "text-red-400",    bg: "bg-red-500/10",    border: "border-red-500/30",    line: "#ef4444" },
  gray:   { text: "text-gray-400",   bg: "bg-gray-500/10",   border: "border-gray-500/30",   line: "#6b7280" },
  cyan:   { text: "text-cyan-400",   bg: "bg-cyan-500/10",   border: "border-cyan-500/30",   line: "#06b6d4" },
};

const LANES: { key: Actor; emoji: string; name: string; sub: string }[] = [
  { key: "buyer",       emoji: "🤖", name: "Buyer Agent",      sub: "買い手" },
  { key: "seller",      emoji: "🖥️", name: "Seller API",      sub: "売り手" },
  { key: "facilitator", emoji: "🏦", name: "Facilitator",  sub: "決済仲介" },
  { key: "blockchain",  emoji: "⛓️", name: "Base Sepolia", sub: "ブロックチェーン" },
];

const LANE_X: Record<Actor, number> = { buyer: 12.5, seller: 37.5, facilitator: 62.5, blockchain: 87.5 };

function DataToggle({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);
  if (!data) return null;
  return (
    <>
      <button onClick={() => setOpen(!open)} className="text-[10px] text-gray-500 hover:text-gray-300 underline">{open ? "閉じる" : "詳細"}</button>
      {open && <pre className="mt-1 p-2 bg-black/50 rounded text-[11px] text-gray-400 overflow-x-auto max-h-40 overflow-y-auto text-left whitespace-pre">{JSON.stringify(data, null, 2)}</pre>}
    </>
  );
}

function Lifelines() {
  return (
    <>
      {Object.values(LANE_X).map((x, i) => (
        <div key={i} className="absolute top-0 bottom-0" style={{ left: `${x}%` }}>
          <div className="w-px h-full bg-gray-800" />
        </div>
      ))}
    </>
  );
}

function StepRow({ step, index }: { step: Step; index: number }) {
  const c = CLS[step.color] || CLS.gray;

  if (step.isSystem) {
    const x = LANE_X[step.from];
    return (
      <div className="relative animate-fadeIn" style={{ animationDelay: `${index * 100}ms` }}>
        <div className="absolute inset-0 pointer-events-none"><Lifelines /></div>
        <div className="relative z-10 py-2">
          <div className="absolute" style={{ left: `${x}%` }}>
            <div className={`px-3 py-1.5 rounded-lg ${c.bg} border ${c.border} whitespace-nowrap`}>
              <span className={`text-xs ${c.text}`}>{step.label}</span>
            </div>
          </div>
          <div className="h-8" />
        </div>
      </div>
    );
  }

  const fromX = LANE_X[step.from];
  const toX = LANE_X[step.to];
  const goingRight = toX > fromX;
  const leftPct = Math.min(fromX, toX);
  const widthPct = Math.abs(toX - fromX);

  return (
    <div className="relative animate-fadeIn" style={{ animationDelay: `${index * 100}ms` }}>
      <div className="absolute inset-0 pointer-events-none"><Lifelines /></div>

      <div className="relative z-10">
        {/* Label - positioned at from-actor's lane */}
        <div className="relative py-1" style={{ marginLeft: `${leftPct}%`, width: `${widthPct}%` }}>
          <div className={goingRight ? "text-left" : "text-right"}>
            <div className={`inline-block px-2 py-1 rounded ${c.bg} border ${c.border} max-w-[280px]`}>
              <div className={`text-[11px] font-semibold ${c.text} leading-tight`}>{step.label}</div>
              {step.detail && <div className="text-[10px] text-gray-500 leading-tight mt-0.5 break-all">{step.detail}</div>}
              {(step.txHash || step.data) && (
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {step.txHash && <a href={`https://sepolia.basescan.org/tx/${step.txHash}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-cyan-400 hover:text-cyan-300 underline">Basescan ↗</a>}
                  {step.data && <DataToggle data={step.data} />}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Arrow */}
        <div className="h-5 relative">
          <svg className="absolute inset-0 w-full h-full overflow-visible">
            <defs>
              <marker id={`a-${step.id}`} markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
                <path d="M0,0 L7,2.5 L0,5" fill={c.line} />
              </marker>
            </defs>
            <line
              x1={`${fromX}%`} y1="50%"
              x2={`${toX}%`} y2="50%"
              stroke={c.line}
              strokeWidth="2"
              strokeDasharray={goingRight ? "none" : "6,4"}
              markerEnd={`url(#a-${step.id})`}
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [totalSpent, setTotalSpent] = useState(0);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`${API_URL}/events`);
    es.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.type === "connected") { setConnected(true); return; }
      const ev = d as LogEvent;
      setLogs((p) => [...p, ev]);
      if (ev.type === "response_200" && ev.txHash) {
        if (ev.url.includes("/products/")) setTotalSpent((p) => p + 0.01);
        else if (ev.url.includes("/purchase")) setTotalSpent((p) => p + 0.1);
      }
      if (ev.type === "error" || (ev.method === "SYSTEM" && ev.type === "response_200")) setIsRunning(false);
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const steps = logs.flatMap(toSteps);

  return (
    <main className="max-w-6xl mx-auto p-6">
      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .animate-fadeIn { animation: fadeIn 0.3s ease-out both; }
      `}</style>

      <header className="mb-6 text-center">
        <h1 className="text-2xl font-bold mb-1">x402 エージェント間取引デモ</h1>
        <p className="text-gray-500 text-sm">AIエージェントがAPI呼び出しごとに自動でUSDC決済を行います</p>
      </header>

      <div className="flex items-center justify-between mb-4 bg-gray-900 border border-gray-800 rounded-lg p-3">
        <button
          onClick={() => { setIsRunning(true); setLogs([]); setTotalSpent(0); fetch(`${API_URL}/start`, { method: "POST" }).catch(() => setIsRunning(false)); }}
          disabled={isRunning || !connected}
          className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm font-medium transition-colors"
        >
          {isRunning ? "実行中..." : "デモを開始"}
        </button>
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
            <span className="text-xs text-gray-400">{connected ? "接続中" : "未接続"}</span>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-gray-500">合計支払額</div>
            <div className="text-base font-mono font-bold text-green-400">${totalSpent.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {logs.length === 0 && !isRunning && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 mb-4">
          <div className="grid grid-cols-4 gap-3 mb-4">
            {LANES.map(({ emoji, name, sub }) => (
              <div key={name} className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-center">
                <div className="text-xl">{emoji}</div>
                <div className="text-sm font-semibold">{name}</div>
                <div className="text-xs text-gray-500">{sub}</div>
              </div>
            ))}
          </div>
          <ol className="text-xs text-gray-400 space-y-1.5">
            <li><span className="text-blue-400 font-bold">1.</span> 買い手 → 売り手にAPIリクエスト</li>
            <li><span className="text-yellow-400 font-bold">2.</span> 有料APIは 402 を返す</li>
            <li><span className="text-purple-400 font-bold">3.</span> 買い手がEIP-3009署名して再送</li>
            <li><span className="text-orange-400 font-bold">4.</span> Facilitatorが署名検証</li>
            <li><span className="text-cyan-400 font-bold">5.</span> ブロックチェーン上でUSDC送金（transferWithAuthorization）</li>
            <li><span className="text-green-400 font-bold">6.</span> 決済完了 → データ返却</li>
          </ol>
        </div>
      )}

      {(logs.length > 0 || isRunning) && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <div className="grid grid-cols-4 border-b border-gray-700 bg-gray-900 sticky top-0 z-20">
            {LANES.map(({ emoji, name, sub }) => (
              <div key={name} className="py-2.5 text-center">
                <div className="text-base leading-none">{emoji}</div>
                <div className="text-xs font-semibold mt-1">{name}</div>
                <div className="text-[10px] text-gray-500">{sub}</div>
              </div>
            ))}
          </div>

          <div className="max-h-[600px] overflow-y-auto py-2">
            {steps.length === 0 && isRunning && (
              <div className="text-center text-gray-500 py-10 text-sm">処理を開始しています...</div>
            )}
            {steps.map((step, i) => (
              <StepRow key={step.id} step={step} index={i} />
            ))}
            <div ref={scrollRef} />
          </div>
        </div>
      )}
    </main>
  );
}
