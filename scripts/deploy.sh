#!/bin/sh
# Выкладка на боевую машину: скачать образы, собранные в CI под текущий
# коммит, и поднять их. Сборки здесь нет — она занимала семь минут, и всё это
# время сайт работал на остановленном процессе.
#
# Образ есть только у коммита, прошедшего проверки в CI. Если его нет —
# скачивание падает, и выкладка не происходит: непроверенный код сюда не
# попадает даже по ошибке.
#
# После подъёма — проверка /api/health. Не ответил «ok» за минуту — скрипт
# падает и печатает команду отката (scripts/rollback.sh). Удачная выкладка
# дописывается в .deploy-history: по нему откат находит прошлый коммит.
#
# `--at <sha>` — поднять уже вычекнутый коммит без git pull и без записи в
# историю; так его зовёт rollback.sh (копией, с DEPLOY_ROOT — каталогом
# репозитория). DRY_RUN=1 — только печатать команды.
set -eu
cd "${DEPLOY_ROOT:-$(dirname "$0")/..}"

run() { if [ "${DRY_RUN:-}" = 1 ]; then echo "+ IMAGE_TAG=${IMAGE_TAG:-} $*"; else "$@"; fi; }
history=.deploy-history
command -v curl >/dev/null || { echo "Нужен curl: им проверяется /api/health после подъёма." >&2; exit 1; }

if [ "${1:-}" = --at ]; then
  IMAGE_TAG=$2
  rollback=1
else
  # После отката HEAD отвязан от ветки, и pull без ветки не работает.
  git symbolic-ref -q HEAD >/dev/null || run git checkout main
  run git pull --ff-only
  IMAGE_TAG=$(git rev-parse HEAD)
  rollback=
fi
export IMAGE_TAG

compose="docker compose -f docker-compose.prod.yml --env-file .env.production"
run $compose pull web worker migrate
# --no-build: если образа почему-то нет, лучше упасть, чем молча собирать
# семь минут на месте.
run $compose up -d --no-build
# Правку конфига Caddy compose не замечает: контейнер тот же, меняется
# только файл в подключённом каталоге. Перезагрузка без остановки — сайт
# при этом не моргает.
run $compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile

# Адрес — первый домен из SITE_DOMAIN (там список через запятую). Файл не
# подключается целиком: строки с пробелами sh не прочтёт. Нет домена — веб
# напрямую на петле.
domain=$(sed -n 's/^SITE_DOMAIN=//p' .env.production 2>/dev/null | tail -n1 | cut -d, -f1 | tr -d ' "'"'")
if [ -n "$domain" ]; then url="https://$domain/api/health"; else url="http://127.0.0.1:3000/api/health"; fi

healthy() {
  i=0
  while [ $i -lt 30 ]; do
    out=$(curl -sS --max-time 5 -w ' %{http_code}' "$url" 2>/dev/null) || out=
    case "$out" in *'"status":"ok"'*' 200') return 0 ;; esac
    i=$((i + 1))
    sleep 2
  done
  return 1
}

if [ "${DRY_RUN:-}" = 1 ]; then
  echo "+ проверка $url"
elif ! healthy; then
  prev=$(awk -v cur="$IMAGE_TAG" '$1 != cur { s = $1 } END { print s }' "$history" 2>/dev/null) || prev=
  echo "ОШИБКА: $url не ответил 200 со status ok за минуту (образ $IMAGE_TAG)." >&2
  echo "Логи: $compose logs --tail=100 web" >&2
  if [ -n "$rollback" ]; then
    echo "Это уже откат. Выберите другой коммит: sh scripts/rollback.sh <sha>" >&2
  elif [ -n "$prev" ]; then
    echo "Откат: sh scripts/rollback.sh $prev" >&2
  else
    echo "Истории выкладок нет. Откат: sh scripts/rollback.sh <sha прошлого рабочего коммита>" >&2
  fi
  exit 1
fi

if [ -z "$rollback" ] && [ "${DRY_RUN:-}" != 1 ]; then
  echo "$IMAGE_TAG $(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$history"
fi
echo "Выложен $(git log --oneline -1 "$IMAGE_TAG")"
