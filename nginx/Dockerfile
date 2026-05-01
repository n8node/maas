# syntax=docker/dockerfile:1
FROM nginx:1.27-alpine

RUN apk add --no-cache curl \
    && mkdir -p /var/www/certbot

COPY nginx.conf /etc/nginx/nginx.conf
COPY conf.d/default.conf conf.d/locations.inc conf.d/https.conf.sample /etc/nginx/conf.d/

EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
