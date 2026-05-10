# Use official Node.js image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Copy all source files
COPY . .

# Create uploads directory
RUN mkdir -p src/uploads

# Expose port
EXPOSE 5000

# Start the server
CMD ["node", "server.js"]