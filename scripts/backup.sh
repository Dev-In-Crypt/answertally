#!/bin/sh
# Ночная копия базы и хранилища — на этой же машине, а затем в Storage Box.
#
# Локальная защищает от ошибки в данных: неудачная миграция, удаление не
# того, сбой при выкладке. От потери самой машины — копия вне её
# (backup-offsite.sh; пока не настроена, шаг пропускается).
#
# Восстановление базы:
#   docker exec -i answertally-prod-postgres-1 pg_restore -U aisdos -d aisdos --clean < db-<время>.dump
# Хранилища: распаковать storage-<время>.tgz в том answertally-prod_storage-data.
# Копию из Storage Box в эти же файлы достаёт scripts/restore-offsite.sh.
set -eu

# В копиях — все данные агентств. Читать их может только владелец: и новые
# файлы (umask), и сам каталог, даже если он создан раньше с другими правами.
umask 077
dest=/opt/answertally-backups
mkdir -p "$dest"
chmod 700 "$dest"
stamp=$(date -u +%Y%m%d-%H%M)

# -Fc: сжатый формат, восстанавливается выборочно и в другую версию Postgres.
docker exec answertally-prod-postgres-1 pg_dump -U aisdos -Fc aisdos > "$dest/db-$stamp.dump"

# Сырые ответы и логотипы. Без сырых ответов измерения нельзя переразобрать,
# когда меняется парсер, — копия этого тома так же обязательна, как базы.
# tar в контейнере пишет от root, и umask хоста на него не действует. Архив
# отдаётся владельцу каталога: иначе отправка в Storage Box его не прочтёт.
docker run --rm -v answertally-prod_storage-data:/data:ro -v "$dest":/out alpine \
  sh -c "umask 077 && tar czf /out/storage-$stamp.tgz -C /data . && chown $(id -u):$(id -g) /out/storage-$stamp.tgz"

# Копии старше двух недель — только наши собственные копии, не данные:
# без этого диск заполнится, и упадёт сначала база.
find "$dest" -name 'db-*.dump' -mtime +14 -delete
find "$dest" -name 'storage-*.tgz' -mtime +14 -delete

echo "Копия $stamp: $(du -sh "$dest" | cut -f1) всего"

"$(dirname "$0")/backup-offsite.sh" "$dest" "$stamp"
