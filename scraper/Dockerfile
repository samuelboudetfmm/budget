# Image officielle : Chromium et ses dépendances déjà installés (même version que playwright-core)
FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /srv
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.mjs ./
ENV NODE_ENV=production PORT=3000
USER pwuser
EXPOSE 3000
CMD ["node", "server.mjs"]
