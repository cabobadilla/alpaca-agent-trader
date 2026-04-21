FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm config set strict-ssl false && npm install

FROM node:20-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 5173
CMD ["npx", "vite", "--host", "0.0.0.0"]
