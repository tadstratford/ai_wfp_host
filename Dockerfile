# WorkflowPeople — self-host (DB_BACKEND=sqlite) deployment image.
# Builds the Tailwind CSS and runs the Bun server directly against the source.
FROM oven/bun:1-alpine

WORKDIR /app

# Install dependencies (frozen lockfile).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy the app source and build the compiled CSS.
COPY . .
RUN bun run build:css

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "src/server/index.tsx"]
