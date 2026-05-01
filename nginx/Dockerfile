# syntax=docker/dockerfile:1
FROM nginx:1.27-alpine

RUN apk add --no-cache curl \
    && mkdir -p /var/www/certbot

COPY nginx.conf /etc/nginx/nginx.conf
# Весь conf.d: после `cp https.conf.sample https.conf` на сервере файл попадает в контекст сборки и копируется в образ.
# Подхватываются только *.conf (см. nginx.conf); locations.inc подключается через include; *.sample не матчится.
COPY conf.d/ /etc/nginx/conf.d/

EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
