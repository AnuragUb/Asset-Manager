FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package.json files first for better caching
# We need the root package.json and the sub-folder package.json files
COPY package.json ./
COPY web-app/asset-manager-backend/package.json ./web-app/asset-manager-backend/
COPY web-app/asset-manager-frontend/package.json ./web-app/asset-manager-frontend/

# Install backend dependencies
WORKDIR /app/web-app/asset-manager-backend
RUN npm install --production

# Install frontend dependencies (if any needed for build)
WORKDIR /app/web-app/asset-manager-frontend
RUN npm install --production

# Copy source code
WORKDIR /app
COPY web-app/ ./web-app/

# Create data directory
RUN mkdir -p /app/data

# Expose the port (default 8080)
EXPOSE 8080

# Environment variables
ENV PORT=8080
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV DB_PATH=/app/data/database_v2.db

# Start the application
WORKDIR /app/web-app/asset-manager-backend
CMD ["node", "server.js"]
