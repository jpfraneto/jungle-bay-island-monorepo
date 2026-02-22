FROM oven/bun:1 AS base
WORKDIR /app

# Install backend deps
COPY backend/package.json backend/bun.lock ./backend/
RUN cd backend && bun install --production

COPY backend/ ./backend/

EXPOSE ${PORT:-3001}

WORKDIR /app/backend
CMD ["bun", "run", "src/index.ts"]
