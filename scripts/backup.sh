#!/bin/sh
# Ночная копия базы и хранилища — на этой же машине.
#
# Защищает от ошибки в данных: неудачная миграция, удаление не того, сбой
# при выкладке. От потери самой машины не защищает — для этого нужна копия
# в другом месте (снимки Hetzner или внешнее хранилище), и это отдельное
# решение, потому что стоит денег.
#
# Восстановление базы:
#   docker exec -i answertally-prod-postgres-1 pg_restore -U aisdos -d aisdos --clean < db-<время>.dump
# Хранилища: распаковать storage-<время>.tgz в том answertally-prod_storage-data.
set -eu

dest=/opt/answertally-backups
mkdir -p "$dest"
stamp=$(date -u +%Y%m%d-%H%M)

# -Fc: сжатый формат, восстанавливается выборочно и в другую версию Postgres.
docker exec answertally-prod-postgres-1 pg_dump -U aisdos -Fc aisdos > "$dest/db-$stamp.dump"

# Сырые ответы и логотипы. Без сырых ответов измерения нельзя переразобрать,
# когда меняется парсер, — копия этого тома так же обязательна, как базы.
docker run --rm -v answertally-prod_storage-data:/data:ro -v "$dest":/out alpine \
  tar czf "/out/storage-$stamp.tgz" -C /data .

# Копии старше двух недель — только наши собственные копии, не данные:
# без этого диск заполнится, и упадёт сначала база.
find "$dest" -name 'db-*.dump' -mtime +14 -delete
find "$dest" -name 'storage-*.tgz' -mtime +14 -delete

echo "Копия $stamp: $(du -sh "$dest" | cut -f1) всего"
