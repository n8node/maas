# syntax=docker/dockerfile:1
FROM nginx:1.27-alpine

RUN apk add --no-cache curl \
    && mkdir -p /var/www/certbot

COPY nginx.conf /etc/nginx/nginx.conf
COPY conf.d/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
