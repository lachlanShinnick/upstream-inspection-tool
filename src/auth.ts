import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Upstream Property's Entra tenant. Verified in the signIn callback as a
// belt-and-braces check on top of the single-tenant Entra app registration.
const UPSTREAM_TENANT_ID = "418f1be9-7142-48e3-ad19-cec645b844bf";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      // Override the provider default ("openid profile email User.Read") with
      // everything the app needs: offline_access for refresh tokens, Files.ReadWrite.All
      // for OneDrive, Mail.Send for the Outlook draft.
      authorization: {
        params: {
          scope:
            "openid profile email offline_access User.Read Files.ReadWrite.All Mail.Send",
        },
      },
    }),
  ],
  pages: {
    // Route both the sign-in screen and auth errors to /login so we can render
    // a branded message instead of the built-in Auth.js error page.
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ profile }) {
      // 1. Reject anyone outside Upstream's tenant. Returning false sends the
      //    user to /login?error=AccessDenied.
      if (profile?.tid !== UPSTREAM_TENANT_ID) {
        return false;
      }

      // oid (Entra Object ID) is the stable per-user key. Without it we can't
      // upsert, so treat its absence as a rejection.
      const oid = typeof profile.oid === "string" ? profile.oid : undefined;
      if (!oid) return false;

      // 2. Upsert the user into Supabase, keyed on m365_oid.
      const { error } = await supabaseAdmin()
        .from("users")
        .upsert(
          {
            m365_oid: oid,
            email: (profile.email ?? profile.preferred_username) as string,
            name: profile.name as string,
          },
          { onConflict: "m365_oid" },
        );

      if (error) {
        // A DB failure is not a "wrong tenant" rejection — throw so the user
        // sees a generic error rather than the misleading Upstream-account message.
        console.error("[auth] users upsert failed:", error.message);
        throw new Error("Failed to record user in Supabase.");
      }

      return true;
    },
    async jwt({ token, account, profile }) {
      // First sign-in: stash the Graph tokens and oid (account/profile only
      // present on the initial call).
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at; // epoch seconds
      }
      if (typeof profile?.oid === "string") {
        token.oid = profile.oid;
      }

      // Still valid (with a 60s safety buffer)? Use as-is.
      if (token.expiresAt && Date.now() < token.expiresAt * 1000 - 60_000) {
        return token;
      }

      // Expired (or no expiry recorded) — refresh using the refresh token.
      if (!token.refreshToken) {
        token.error = "NoRefreshToken";
        return token;
      }

      try {
        const res = await fetch(
          `https://login.microsoftonline.com/${UPSTREAM_TENANT_ID}/oauth2/v2.0/token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
              client_secret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
              grant_type: "refresh_token",
              refresh_token: token.refreshToken,
              scope:
                "openid profile email offline_access User.Read Files.ReadWrite.All Mail.Send",
            }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw data;

        token.accessToken = data.access_token;
        token.expiresAt = Math.floor(Date.now() / 1000) + Number(data.expires_in);
        // Entra rotates refresh tokens — keep the new one when provided.
        if (data.refresh_token) token.refreshToken = data.refresh_token;
        delete token.error;
      } catch (e) {
        console.error("[auth] token refresh failed:", e);
        token.error = "RefreshFailed";
      }
      return token;
    },
    async session({ session, token }) {
      if (token.oid) session.user.oid = token.oid;
      if (token.accessToken) session.accessToken = token.accessToken;
      if (token.error) session.error = token.error;
      return session;
    },
  },
});
