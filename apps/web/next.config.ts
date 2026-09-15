import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["postgres"],
  transpilePackages: ["@casino/db"],
};

export default nextConfig;
