import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Resized photos are ~300KB, but allow headroom for the occasional larger
    // capture sent through the upload server action.
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
