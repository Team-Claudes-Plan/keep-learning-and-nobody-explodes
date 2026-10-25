# syntax=docker/dockerfile:1
#
# Production frontend: the static build served by nginx, which also proxies
# /backend/* (REST, uploads and websockets) to the backend service.

FROM oven/bun:1.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# The browser reaches the backend through the proxy below.
ENV VITE_API_URL=/backend
RUN bun run build


FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
