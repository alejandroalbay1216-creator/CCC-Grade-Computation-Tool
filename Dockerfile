FROM dunglas/frankenphp:1-php8.4-alpine

WORKDIR /app

RUN install-php-extensions pdo_mysql mbstring

COPY Caddyfile /etc/caddy/Caddyfile
COPY frontend/ /app/frontend/
COPY backend/config/ /app/backend/config/
COPY backend/public/ /app/backend/public/

ENV APP_ENV=production
ENV PORT=80

CMD ["frankenphp", "run", "--config", "/etc/caddy/Caddyfile"]
