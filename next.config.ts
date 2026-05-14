import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use Turbopack (default in Next.js 16+)
  // solclientjs browser SDK works without special config in Turbopack
  turbopack: {
    // Resolve aliases for browser compatibility
    resolveAlias: {
      // These Node.js modules are not needed in browser - provide empty stubs
      net: { browser: './src/lib/stubs/empty.js' },
      tls: { browser: './src/lib/stubs/empty.js' },
      fs: { browser: './src/lib/stubs/empty.js' },
      dns: { browser: './src/lib/stubs/empty.js' },
    },
  },
  
  // Exclude solclientjs from server-side bundling (browser-only SDK)
  serverExternalPackages: ['solclientjs'],
};

export default nextConfig;
