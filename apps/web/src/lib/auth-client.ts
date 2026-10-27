// The browser's Better Auth client: email + password, the emailed codes, and
// the OAuth provider's page helpers (sign-in and /consent resume a pending
// agent authorization from the page's own query string).
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [convexClient(), emailOTPClient(), oauthProviderClient()],
});
