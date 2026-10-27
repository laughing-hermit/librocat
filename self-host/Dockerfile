# librocat, self-hosted: the site (dashboard and remote MCP at /mcp) and the
# Convex functions it runs on, built from this repository. self-host/compose.yaml
# runs it twice: once to deploy the functions (deploy.sh), then as the site.
FROM node:24-bookworm-slim
ENV NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 LIBROCAT_SELF_HOST=1
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# Browsers and the site's server both reach Convex at these URLs: in the
# compose file the site shares the Convex container's network, so 127.0.0.1
# is Convex from both sides. Behind a domain, build with your public URLs.
ARG NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210
ARG NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211
# The address people and agents use: the OAuth resource and issuer are built
# from it (the server binds 0.0.0.0, which is not an address to advertise).
ARG NEXT_PUBLIC_LIBROCAT_MCP_URL=http://localhost:3000/mcp
ENV NEXT_PUBLIC_CONVEX_URL=$NEXT_PUBLIC_CONVEX_URL \
    NEXT_PUBLIC_CONVEX_SITE_URL=$NEXT_PUBLIC_CONVEX_SITE_URL \
    NEXT_PUBLIC_LIBROCAT_MCP_URL=$NEXT_PUBLIC_LIBROCAT_MCP_URL
RUN pnpm run build
EXPOSE 3000
# exec: Next.js is PID 1 and gets the stop signal (pnpm would not pass it on).
CMD ["sh", "-c", "cd apps/web && exec node_modules/.bin/next start --port 3000 --hostname 0.0.0.0"]
