#!/bin/sh
# Достаёт копию из Storage Box в локальные файлы — те же db-<метка>.dump и
# storage-<метка>.tgz, что пишет backup.sh. Живую базу и том не трогает:
# заливка — отдельный ручной шаг, команды в шапке backup.sh.
#
#   scripts/restore-offsite.sh                  последняя копия в ./restore-<метка>
#   scripts/restore-offsite.sh 20261009-0315    указанная (список: borg list)
#   scripts/restore-offsite.sh <метка> <каталог>
#
# Вне сервера (машина сгорела): установить borg, положить ключ SSH и файл
# с паролем из менеджера паролей, задать OFFSITE_BACKUP_* в окружении.
set -eu
. "$(dirname "$0")/offsite-env.sh"
offsite_configured || { echo "offsite backup not configured" >&2; exit 1; }

stamp=${1:-$(borg list --short --glob-archives '*-db' --last 1 | sed 's/-db$//')}
[ -n "$stamp" ] || { echo "В Storage Box нет ни одной копии" >&2; exit 1; }
out=${2:-restore-$stamp}

# В копии — все данные агентств.
umask 077
mkdir -p "$out"
borg extract --stdout "::$stamp-db" > "$out/db-$stamp.dump"
borg export-tar "::$stamp-storage" "$out/storage-$stamp.tgz"

ls -l "$out"
