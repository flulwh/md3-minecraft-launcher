# ---- Build stage -----------------------------------------------------------
FROM node:22-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Install deps (lockfile + manifests first for better layer caching)
COPY package.json pnpm-lock.yaml* ./
COPY prisma ./prisma
COPY tsconfig.json ./
RUN pnpm install --frozen-lockfile || pnpm install

# Generate the Prisma client and compile to dist/
RUN pnpm db:generate
COPY src ./src
RUN pnpm build

# ---- Runtime stage ---------------------------------------------------------
FROM node:22-slim AS runtime

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV="production"
# Absolute SQLite path so prisma CLI and the app agree on the same file.
ENV DATABASE_URL="file:/app/data/launcher.db"
ENV HOST="0.0.0.0"
ENV PORT="8787"
ENV DATA_DIR="/app/data"
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod || pnpm install --prod

COPY prisma ./prisma
COPY --from=build /app/node_modules/.pnpm /app/node_modules/.pnpm
COPY --from=build /app/node_modules/@prisma /app/node_modules/@prisma
COPY --from=build /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client /app/node_modules/@prisma/client
COPY --from=build /app/dist ./dist

# Ensure the SQLite data dir exists before prisma db push / app connect.
RUN mkdir -p /app/data

EXPOSE 8787

# Create/refresh the schema, then start the compiled server.
CMD ["sh", "-c", "pnpm db:push --skip-generate && node dist/server.js"]
