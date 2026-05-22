# Use a stable Node.js version
FROM node:20-slim

# Install minimal system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json ./
COPY web-app/asset-manager-backend/package.json ./web-app/asset-manager-backend/
COPY web-app/asset-manager-frontend/package.json ./web-app/asset-manager-frontend/

# Install backend dependencies (using bcryptjs, so no native build needed)
WORKDIR /app/web-app/asset-manager-backend
RUN npm install --production --no-audit --no-fund --network-timeout=600000

# Install frontend dependencies
WORKDIR /app/web-app/asset-manager-frontend
RUN npm install --no-audit --no-fund --network-timeout=600000

# Copy source code
WORKDIR /app
COPY web-app/asset-manager-frontend/ ./web-app/asset-manager-frontend/
COPY web-app/asset-manager-backend/ ./web-app/asset-manager-backend/

# Build frontend
WORKDIR /app/web-app/asset-manager-frontend
RUN npm run build

# Final Stage
WORKDIR /app/web-app/asset-manager-backend
EXPOSE 8080 9090
CMD ["node", "server.js"]
