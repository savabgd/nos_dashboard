# VoLTE KPI Dashboard - Frontend Production Build
# =================================================
# Stage 1: build the Vite bundle
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ARG VITE_AUTO_REFRESH_INTERVAL=300000
ENV VITE_AUTO_REFRESH_INTERVAL=${VITE_AUTO_REFRESH_INTERVAL}

RUN npm run build

# Stage 2: serve the built app with nginx
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]