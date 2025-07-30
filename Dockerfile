FROM python:3.12-slim as builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt pyproject.toml ./
RUN pip install --user --no-warn-script-location -r requirements.txt

FROM python:3.12-slim

WORKDIR /app
COPY --from=builder /root/.local /root/.local
COPY . .

ENV PATH=/root/.local/bin:$PATH
ENV PYTHONPATH=/app

# Default configuration
ENV MCP_CONFIG_DIR=/app/config
ENV MCP_DATA_DIR=/app/data
ENV MEMORY_FILE_PATH=/app/data/memory.json

# Create necessary directories
RUN mkdir -p /app/config /app/data /app/cache

# Set permissions
RUN chmod +x setup.sh

# Create volume mount points for persistence
VOLUME ["/app/config", "/app/data"]

ENTRYPOINT ["python", "-m", "memory_mcp"]