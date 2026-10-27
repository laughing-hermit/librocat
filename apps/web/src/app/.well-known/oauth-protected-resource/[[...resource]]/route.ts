// RFC 9728 protected resource metadata for the remote MCP, at both
// /.well-known/oauth-protected-resource and the path-inserted form for the
// /mcp resource (/.well-known/oauth-protected-resource/mcp). The 401 from
// /mcp points agents here; this names the authorization server.
import { corsPreflight, protectedResourceMetadata } from "@/lib/oauth";

export const GET = (req: Request) => protectedResourceMetadata(req);
export const OPTIONS = corsPreflight;
