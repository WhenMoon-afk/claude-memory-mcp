# Stage 1: Build
FROM node:20 AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Set environment variables
ENV MEMORY_DB_PATH=/data/memory.db
ENV NODE_ENV=production

# Create volume mount point for persistent database
VOLUME ["/data"]

# Note: This is an MCP stdio server (not HTTP), so no port is exposed.
# Communication happens via stdin/stdout when running the container.

# Start the server
CMD ["npm", "start"]
