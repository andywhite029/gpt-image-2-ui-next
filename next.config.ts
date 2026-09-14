import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "sharp"],
  allowedDevOrigins: ["http://127.0.0.1:8787", "http://localhost:8787"],
};

export default nextConfig;