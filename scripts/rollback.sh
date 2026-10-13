#!/bin/sh
# Откат выкладки: поднять образы прошлого коммита без git pull.
#
#   sh scripts/rollback.sh          — последний удачно выложенный коммит,
#                                     отличный от текущего (.deploy-history)
#   sh scripts/rollback.sh <sha>    — конкретный коммит
#
# Миграции базы НЕ откатываются. По правилам проекта они только добавляют
# (ADD COLUMN, CREATE TABLE/INDEX), поэтому старый код работает на новой
# схеме. Если миграция что-то удаляла или переименовывала (в файле есть
# `-- allow-destructive:`), откат кода её не вернёт — нужна копия базы.
#
# Возврат к обычной выкладке: git checkout main && sh scripts/deploy.sh
# (deploy.sh и сам переключается на main, если HEAD отвязан).
# DRY_RUN=1 — только печатать команды.
set -eu
cd "$(dirname "$0")/.."

run() { if [ "${DRY_RUN:-}" = 1 ]; then echo "+ IMAGE_TAG=${IMAGE_TAG:-} $*"; else "$@"; fi; }
current=$(git rev-parse HEAD)

if [ $# -gt 0 ]; then
  target=$1
else
  # Повторный откат без аргумента вернул бы на тот коммит, с которого
  # откатывались: в истории он последний, отличный от текущего.
  if ! git symbolic-ref -q HEAD >/dev/null; then
    echo "Уже откат (HEAD отвязан от ветки). Укажите коммит: sh scripts/rollback.sh <sha>" >&2
    exit 1
  fi
  target=$(awk -v cur="$current" '$1 != cur { s = $1 } END { print s }' .deploy-history 2>/dev/null) || target=
  if [ -z "$target" ]; then
    echo "В .deploy-history нет прошлой выкладки. Укажите коммит: sh scripts/rollback.sh <sha>" >&2
    exit 1
  fi
fi
target=$(git rev-parse --verify "$target^{commit}")

# Сначала образы: нет их — ничего не трогаем, сайт работает как работал.
IMAGE_TAG=$target
export IMAGE_TAG
run docker compose -f docker-compose.prod.yml --env-file .env.production pull web worker migrate
# Подъём — этим deploy.sh, а не тем, что лежит в старом коммите: там его
# может не быть вовсе, или он ещё делает git pull.
deploy=$(mktemp)
trap 'rm -f "$deploy"' EXIT
cp scripts/deploy.sh "$deploy"
run git checkout --detach "$target"
DEPLOY_ROOT=$PWD sh "$deploy" --at "$target"

echo "Откат на $target. Вернуться к main: git checkout main && sh scripts/deploy.sh"
