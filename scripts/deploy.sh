#!/bin/sh
# Выкладка на боевую машину: скачать образы, собранные в CI под текущий
# коммит, и поднять их. Сборки здесь нет — она занимала семь минут, и всё это
# время сайт работал на остановленном процессе.
#
# Образ есть только у коммита, прошедшего проверки в CI. Если его нет —
# скачивание падает, и выкладка не происходит: непроверенный код сюда не
# попадает даже по ошибке.
set -eu
cd "$(dirname "$0")/.."

git pull --ff-only

IMAGE_TAG=$(git rev-parse HEAD)
export IMAGE_TAG

compose="docker compose -f docker-compose.prod.yml --env-file .env.production"
$compose pull web worker migrate
# --no-build: если образа почему-то нет, лучше упасть, чем молча собирать
# семь минут на месте.
$compose up -d --no-build

echo "Выложен $(git log --oneline -1)"
