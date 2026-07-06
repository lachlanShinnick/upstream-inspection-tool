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
    // Resized photos are ~300KB, but allow headroom for the occasional larger
    // capture sent through the upload server action.
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
