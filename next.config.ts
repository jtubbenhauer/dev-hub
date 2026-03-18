import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: {
    position: "bottom-left",
  },
  serverExternalPackages: ["node-pty", "ws"],
};

export default nextConfig;
