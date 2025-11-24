FROM node:22-slim

WORKDIR /usr/src/app

# Copy package files
COPY package.json .

# Install dependencies (use npm install since package-lock.json is gitignored)
RUN npm install --legacy-peer-deps

# Copy application files
COPY . .

# Make start.sh executable
RUN chmod +x start.sh

# Expose port
EXPOSE 3001

# Default command (overridden by railway.json)
CMD ["./start.sh"]
