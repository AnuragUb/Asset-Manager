# Backend Application (Port 8080/9090)
FROM node:18-alpine

# Install necessary build tools for native modules
RUN apk add --no-cache python3 make g++ gcc libc-dev linux-headers py3-pip

WORKDIR /app

# Copy package files
COPY package.json ./
COPY web-app/asset-manager-backend/package.json ./web-app/asset-manager-backend/

# Install dependencies (bcrypt will be compiled for Alpine/Linux here)
WORKDIR /app/web-app/asset-manager-backend
RUN npm install --production --network-timeout=100000 --registry=https://registry.npmjs.org/

# Copy source code (using .dockerignore to skip local node_modules)
WORKDIR /app
COPY web-app/asset-manager-frontend/ ./web-app/asset-manager-frontend/
COPY web-app/asset-manager-backend/ ./web-app/asset-manager-backend/

# Default port
EXPOSE 8080

# Environment variables
ENV PORT=8080
ENV NODE_ENV=production

# Start the application
WORKDIR /app/web-app/asset-manager-backend
CMD ["node", "server.js"]
