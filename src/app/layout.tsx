import type { Metadata } from "next";
import "tldraw/tldraw.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Morpho",
  description: "AI-assisted product and industrial-design concept workspace"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
