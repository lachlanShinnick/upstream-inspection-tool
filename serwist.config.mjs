import { serwist } from "@serwist/next/config";

export default serwist({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  additionalPrecacheEntries: [
    {
      url: "/~offline",
      revision: process.env.VERCEL_GIT_COMMIT_SHA ?? crypto.randomUUID(),
    },
  ],
});
