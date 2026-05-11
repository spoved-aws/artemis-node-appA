FROM node:18-alpine

WORKDIR /usr/app

# 1. Copy dependency files first (better layer caching)
COPY src/package*.json ./

# 2. Install dependencies
RUN npm ci

# 3. Copy application code
COPY src/ .

# 4. Start app
CMD ["node", "index.js"]