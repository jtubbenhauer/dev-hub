import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: {
    position: "bottom-left",
  },
  serverExternalPackages: ["node-pty", "ws", "vscode-jsonrpc"],
  experimental: {
    proxyClientMaxBodySize: "50mb",
  },
};

export default nextConfig;
