# Backend Application (Port 8080/9090)
FROM node:20-alpine

# Install necessary build tools for native modules
RUN apk add --no-cache python3 make g++ gcc libc-dev linux-headers py3-pip \
    && ln -sf python3 /usr/bin/python

# Set Python environment variable for node-gyp
ENV PYTHON=/usr/bin/python3

WORKDIR /app

# Copy package files
COPY package.json ./
COPY web-app/asset-manager-backend/package.json ./web-app/asset-manager-backend/
COPY web-app/asset-manager-frontend/package.json ./web-app/asset-manager-frontend/

# Install backend dependencies
WORKDIR /app/web-app/asset-manager-backend
RUN npm install --production --network-timeout=100000 --registry=https://registry.npmjs.org/

# Install frontend dependencies (including build tools)
WORKDIR /app/web-app/asset-manager-frontend
RUN npm install --network-timeout=100000 --registry=https://registry.npmjs.org/

# Copy source code
WORKDIR /app
COPY web-app/asset-manager-frontend/ ./web-app/asset-manager-frontend/
COPY web-app/asset-manager-backend/ ./web-app/asset-manager-backend/

# Build frontend (Generates the DIST folder required for Port 8080)
WORKDIR /app/web-app/asset-manager-frontend
RUN node build-dev.cjs

# Start the application
WORKDIR /app/web-app/asset-manager-backend
CMD ["node", "server.js"]
