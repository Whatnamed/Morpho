import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Dev-only Next.js "N" badge is not product UI; hide it so it doesn't clutter the canvas.
  devIndicators: false
};

export default nextConfig;
