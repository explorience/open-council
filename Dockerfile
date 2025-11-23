FROM node:22-slim

WORKDIR /usr/src/app

# Copy package files
COPY package.json .

# Install dependencies (use npm install since package-lock.json is gitignored)
RUN npm install --legacy-peer-deps

# Copy application files
COPY . .

# Expose port
EXPOSE 3001

# Start the chatbot server
CMD ["npm", "run", "chat:server"]
