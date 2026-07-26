import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "tldraw/tldraw.css";
import "./globals.css";

// Self-hosted at build time by next/font; --font-sans picks the variable up
// in globals.css. Latin subset only — Chinese text falls through the stack.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });

export const metadata: Metadata = {
  title: "Morpho",
  description: "AI-assisted product and industrial-design concept workspace"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
