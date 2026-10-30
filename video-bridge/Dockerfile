FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.js ./server.js
USER node
ENV NODE_ENV=production
EXPOSE 10000
CMD ["node", "server.js"]
