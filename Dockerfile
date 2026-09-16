# Stage 1: Base with Node.js and Chromium
FROM node:22-bookworm-slim

# Install Chromium and required fonts/system libraries for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV EXECUTABLE_PATH=/usr/bin/chromium
ENV HEADLESS=true
ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

# Install backend dependencies
COPY package*.json tsconfig.json ./
RUN npm install --omit=dev || npm install

# Install and build frontend
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install

COPY frontend ./frontend
RUN cd frontend && npm run build

# Copy backend source code
COPY src ./src

# Create data directory for SQLite persistence
RUN mkdir -p /app/data

EXPOSE 3001

VOLUME ["/app/data"]

CMD ["npm", "start"]
