FROM public.ecr.aws/docker/library/node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-reportlab ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

RUN pnpm build \
  && pnpm prune --prod

RUN mkdir -p output \
  && chown -R node:node /app

USER node

EXPOSE 8080

CMD ["node", "dist/web.js"]
