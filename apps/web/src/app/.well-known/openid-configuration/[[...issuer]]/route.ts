// OpenID Connect discovery, for clients that look for it instead of (or
// before) RFC 8414 metadata: the same authorization server, Better Auth.
import { corsPreflight, proxyDiscovery } from "@/lib/oauth";

export const GET = () => proxyDiscovery("openid-configuration");
export const OPTIONS = corsPreflight;
