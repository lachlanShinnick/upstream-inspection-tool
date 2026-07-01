import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The .docx template is read with fs at runtime; make sure file tracing
  // bundles it with the inspect route's serverless function in production.
  outputFileTracingIncludes: {
    "/inspect/**": ["./src/templates/**"],
  },
  experimental: {
    // Resized photos are ~300KB, but allow headroom for the occasional larger
    // capture sent through the upload server action.
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
