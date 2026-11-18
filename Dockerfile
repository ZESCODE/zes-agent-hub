FROM node:22-alpine

WORKDIR /app

# Copy dependency files
COPY package.json ./

# Install dependencies (no lockfile is committed, so `npm ci` is not available)
RUN npm install --omit=dev

# Copy source code
COPY . .

# Expose the port the hub listens on
EXPOSE 10000

# Start the hub server
CMD ["node", "server/index.js"]
