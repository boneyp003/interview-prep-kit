# Builds and runs packages/api. Repo root is the build context because the
# API depends on packages/core as an npm workspace — see AGENTS.md.
#
# No build step: the app runs its TypeScript source directly under tsx in
# production (documented decision — "Dev/test/CLI runtime" in README.md).
FROM node:22-slim

WORKDIR /app

# Install with the whole workspace present so npm can resolve @ipk/core.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm install --omit=dev

COPY packages/core packages/core
COPY packages/api packages/api

ENV NODE_ENV=production
EXPOSE 4000

CMD ["npm", "run", "-w", "@ipk/api", "start"]
