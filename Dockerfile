FROM oven/bun:1 AS base
WORKDIR /app

# Install frontend deps and build
COPY frontend/package.json frontend/bun.lock ./frontend/
RUN cd frontend && bun install

COPY frontend/ ./frontend/
RUN cd frontend && bun run build

# Install backend deps
COPY backend/package.json backend/bun.lock ./backend/
RUN cd backend && bun install --production

COPY backend/ ./backend/

EXPOSE ${PORT:-3000}

WORKDIR /app/backend
CMD ["bun", "run", "src/index.ts"]
