// Better Auth as a locally installed Convex component (its own tables, its
// own functions). Local rather than the packaged component because the OAuth
// provider plugin adds tables the packaged schema does not carry
// (oauthClient, oauthAccessToken, oauthRefreshToken, oauthConsent).
import { defineComponent } from "convex/server";

const component = defineComponent("betterAuth");

export default component;
