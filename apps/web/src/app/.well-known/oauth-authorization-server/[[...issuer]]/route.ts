// RFC 8414 authorization server metadata. The issuer is <origin>/api/auth, so
// clients ask for /.well-known/oauth-authorization-server/api/auth (and some
// for the bare root form); both serve Better Auth's own document.
import { corsPreflight, proxyDiscovery } from "@/lib/oauth";

export const GET = () => proxyDiscovery("oauth-authorization-server");
export const OPTIONS = corsPreflight;
