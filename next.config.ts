import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The .docx templates are read with fs at runtime (and the path is now
  // computed per report type, which static tracing can't follow); make sure
  // file tracing bundles them with every route that renders a report.
  outputFileTracingIncludes: {
    "/inspect/**": ["./src/templates/**"],
    "/review/**": ["./src/templates/**"],
  },
  experimental: {
    // Camera JPEGs are capped at 3,000,000 bytes before entering IndexedDB.
    // Keep headroom for multipart overhead and existing queued captures.
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
