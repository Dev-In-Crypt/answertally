#!/bin/sh
# Ночная копия — ещё и в Hetzner Storage Box: на случай потери самой машины.
# Запускается из backup.sh после локальной копии: backup-offsite.sh <каталог> <метка>.
#
# Почему borg, а не rsync зашифрованных файлов: Storage Box держит borg на своей
# стороне, а borg сам шифрует (repokey-blake2), делит на повторяющиеся куски и
# чистит по сроку хранения — растущие сырые ответы не ложатся 17 полными копиями.
#
# Ключ шифрования лежит в репозитории под паролем, пароль — в файле на машине
# и у фаундера в менеджере паролей. Без пароля копия не читается никем, и нами тоже.
#
# Не настроено (нет OFFSITE_BACKUP_HOST/USER) — пишет об этом и выходит с 0:
# локальная копия работает как раньше.
set -eu
. "$(dirname "$0")/offsite-env.sh"

if ! offsite_configured; then
  echo "offsite backup not configured"
  exit 0
fi

dir=$1
stamp=$2
for f in "$OFFSITE_BACKUP_SSH_KEY" "$OFFSITE_BACKUP_PASSPHRASE_FILE"; do
  [ -r "$f" ] || { echo "offsite: нет файла $f" >&2; exit 1; }
done

# Два архива за ночь: база и хранилище. Хранилище — через import-tar: borg
# читает файлы внутри .tgz, и неизменные ответы между ночами не копируются
# заново. Сжатие auto: уже сжатое (дамп -Fc) не жмётся второй раз.
cd "$dir"
borg create --compression auto,zstd "::$stamp-db" "db-$stamp.dump"
borg import-tar "::$stamp-storage" "storage-$stamp.tgz"

# 7 ежедневных, 4 недельных, 6 месячных — отдельно для каждого вида архива,
# иначе база и хранилище вытесняли бы друг друга из счёта.
for kind in db storage; do
  borg prune --glob-archives "*-$kind" --keep-daily 7 --keep-weekly 4 --keep-monthly 6
done
# Без compact borg 1.2 только помечает куски удалёнными, а место не освобождает.
borg compact

echo "Копия $stamp отправлена в Storage Box"
