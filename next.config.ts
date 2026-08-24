import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sql.js loads its wasm at runtime; pin turbopack root so it resolves
  // this repo's node_modules (not a parent dir) in dev and build.
  turbopack: {
    root: path.dirname(new URL(import.meta.url).pathname),
  },
  // sql.js is loaded via createRequire at runtime — keep it external so
  // bundlers don't try to trace its wasm/asm assets.
  serverExternalPackages: ["sql.js"],
};

export default nextConfig;
