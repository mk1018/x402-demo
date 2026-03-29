import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "x402 エージェント間取引デモ",
  description: "x402 決済プロトコルによるエージェント間自律取引",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="bg-gray-950 text-gray-100 min-h-screen">{children}</body>
    </html>
  );
}
