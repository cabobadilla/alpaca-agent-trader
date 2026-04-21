FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
# Install all deps including devDependencies (nodemon, tsx) needed for hot-reload
RUN npm config set strict-ssl false && npm install

FROM node:20-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3001
# Use nodemon with --legacy-watch (polling) so macOS Docker volume mounts
# trigger restarts reliably without relying on inotify events.
# --watch src/ ensures nodemon sees NEW files added to the directory (not just existing ones)
CMD ["npx", "nodemon", "--legacy-watch", "--watch", "src/", "-e", "ts,js", "--exec", "npx tsx", "src/index.ts"]
