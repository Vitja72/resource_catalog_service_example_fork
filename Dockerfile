FROM node:22-trixie-slim

ENV NODE_ENV=production \
    PORT=5002

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .
EXPOSE 5002
CMD [ "npm", "start" ]