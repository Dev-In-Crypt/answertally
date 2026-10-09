# shellcheck shell=sh
# Общие настройки копии вне машины. Не запускается, а подключается:
# `. scripts/offsite-env.sh` — из backup-offsite.sh, restore-offsite.sh
# и руками, когда нужно позвать borg (init, list, check).
#
# Значения — из окружения, иначе из .env.production. Не `source` всего
# файла: в нём есть строки с пробелами (SITE_DOMAIN), sh их не прочтёт.
envfile=${OFFSITE_ENV_FILE:-/opt/answertally/.env.production}
conf() { sed -n "s/^$1=//p" "$envfile" 2>/dev/null | tail -n1; }

: "${OFFSITE_BACKUP_HOST:=$(conf OFFSITE_BACKUP_HOST)}"
: "${OFFSITE_BACKUP_USER:=$(conf OFFSITE_BACKUP_USER)}"
: "${OFFSITE_BACKUP_SSH_KEY:=$(conf OFFSITE_BACKUP_SSH_KEY)}"
: "${OFFSITE_BACKUP_PASSPHRASE_FILE:=$(conf OFFSITE_BACKUP_PASSPHRASE_FILE)}"
: "${OFFSITE_BACKUP_SSH_KEY:=$HOME/.ssh/storagebox}"
: "${OFFSITE_BACKUP_PASSPHRASE_FILE:=$HOME/.config/answertally/borg-passphrase}"

offsite_configured() { [ -n "$OFFSITE_BACKUP_HOST" ] && [ -n "$OFFSITE_BACKUP_USER" ]; }

# Storage Box принимает SSH на порту 23; `./` — путь от домашнего каталога
# суб-аккаунта. BatchMode: без ключа ssh не ждёт пароля, а падает — ночью
# его некому вводить.
export BORG_REPO="ssh://$OFFSITE_BACKUP_USER@$OFFSITE_BACKUP_HOST:23/./answertally"
export BORG_RSH="ssh -i $OFFSITE_BACKUP_SSH_KEY -o BatchMode=yes"
export BORG_PASSCOMMAND="cat $OFFSITE_BACKUP_PASSPHRASE_FILE"
