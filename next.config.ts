import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Increase timeout for AI generation routes (default is 10s for serverless)
  // This is mainly for Vercel deployment
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'i.ytimg.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    // Suppress the punycode deprecation warning
    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...config.resolve.fallback,
        punycode: false,
      };
    }

    return config;
  },
  // Turbopack configuration
  turbopack: {
    rules: {
      "*.svg": {
        loaders: ["@svgr/webpack"],
        as: "*.js",
      },
    },
  },
};

export default nextConfig;
