# One build stage for the whole workspace; the targets below only differ in
# what they run. Pick one with `--target` (docker compose does this).
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g npm@12.0.2

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/schema/package.json packages/schema/
COPY packages/triage/package.json packages/triage/
RUN npm ci

COPY . .
RUN npx turbo run build
# Fetch the Prisma schema engine now so `migrate` needs no download at start.
RUN cd packages/db && npx prisma --version

FROM build AS migrate
WORKDIR /app/packages/db
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]

FROM build AS web
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "3000"]
