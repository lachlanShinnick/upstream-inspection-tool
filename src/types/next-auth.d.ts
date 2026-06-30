import type { DefaultSession } from "next-auth";

// Carry the Entra Object ID (oid) and the Graph access token through the
// session/JWT. oid is the stable per-user key (users.m365_oid); accessToken is
// used server-side to call Microsoft Graph.
declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: string;
    user: {
      oid?: string;
    } & DefaultSession["user"];
  }
}

// JWT is canonically defined in @auth/core/jwt and only re-exported by
// next-auth/jwt, so augment the source module for the merge to take effect.
declare module "@auth/core/jwt" {
  interface JWT {
    oid?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    error?: string;
  }
}
