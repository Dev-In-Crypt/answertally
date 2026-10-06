#!/usr/bin/env bash
# Перевод оплаты на боевой Creem одним запуском.
#
# Заводит три тарифа и уведомления об оплате в боевом кабинете, кладёт ключ,
# секрет уведомлений и номера тарифов на сервер и перезапускает сайт. Потом
# проверяет, что сайт принимает уведомления с новым секретом.
#
# Ключ вводится с клавиатуры и не печатается. Он уходит только в Creem и на
# сервер. Повторный запуск не плодит тарифы: уже заведённые находит по
# названию и цене.
#
# Запуск из корня репозитория: bash scripts/creem-go-live.sh
set -euo pipefail

API=https://api.creem.io/v1
SITE=https://answertally.com
SERVER=deploy@2.28.128.53
SSH_KEY="$HOME/.ssh/hetzner_key"

command -v node >/dev/null || { echo "Node.js is needed to read Creem's answers."; exit 1; }

read -rsp "Creem LIVE API key (input hidden): " KEY
echo
case "$KEY" in
  creem_test_*) echo "This is a test key. Turn Test mode off in Creem and create a live key."; exit 1 ;;
  creem_*) ;;
  *) echo "That does not look like a Creem key."; exit 1 ;;
esac

api() { curl -sS -H "x-api-key: $KEY" -H "content-type: application/json" "$@"; }
# Достаёт поле из JSON-ответа; код на JS получает разобранный ответ как `j`.
pick() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j={};try{j=JSON.parse(s)}catch{};$1})"; }

status=$(curl -s -o /dev/null -w '%{http_code}' -H "x-api-key: $KEY" "$API/products/search?page_number=1&page_size=50")
if [ "$status" != 200 ]; then
  echo "Creem rejected the key (HTTP $status). Check that it is a live key with access to products."
  exit 1
fi
echo "1/5 Key accepted by Creem."

existing=$(api "$API/products/search?page_number=1&page_size=50")

product() {
  local name=$1 cents=$2 description=$3 id
  id=$(printf '%s' "$existing" | pick "const p=(j.items||[]).find(p=>p.name==='$name'&&p.price===$cents&&p.billing_period==='every-month');process.stdout.write(p?p.id:'')")
  if [ -z "$id" ]; then
    id=$(api -X POST "$API/products" -d "{\"name\":\"$name\",\"description\":\"$description\",\"price\":$cents,\"currency\":\"USD\",\"billing_type\":\"recurring\",\"billing_period\":\"every-month\",\"tax_mode\":\"exclusive\",\"tax_category\":\"saas\"}" \
      | pick "process.stdout.write(j.id||'')")
  fi
  if [ -z "$id" ]; then
    echo "Could not create the $name plan in Creem." >&2
    exit 1
  fi
  printf '%s' "$id"
}

STARTER=$(product "Starter" 49900 "Up to 3 client accounts and 4,000 AI checks a month. Your whole team included.")
GROWTH=$(product "Growth" 129900 "Up to 10 client accounts and 13,000 AI checks a month. Your whole team included.")
SCALE=$(product "Scale" 249900 "Up to 25 client accounts and 28,500 AI checks a month. Your whole team included.")
echo "2/5 Plans ready: Starter $STARTER, Growth $GROWTH, Scale $SCALE."

hook=$(api -X POST "$API/webhooks" -d "{\"url\":\"$SITE/api/webhooks/creem\",\"name\":\"answertally\",\"events\":[\"checkout.completed\",\"subscription.active\",\"subscription.paid\",\"subscription.update\",\"subscription.trialing\",\"subscription.scheduled_cancel\",\"subscription.past_due\",\"subscription.unpaid\",\"subscription.paused\",\"subscription.canceled\",\"subscription.expired\",\"refund.created\",\"dispute.created\"]}")
SECRET=$(printf '%s' "$hook" | pick "process.stdout.write(j.secret||'')")
if [ ${#SECRET} -lt 10 ]; then
  echo "Creem did not return a webhook secret. If a webhook to $SITE already exists in Settings > Webhooks, delete it and run this again."
  printf '%s' "$hook" | pick "delete j.secret;console.log(JSON.stringify(j).slice(0,300))"
  exit 1
fi
echo "3/5 Payment notifications set up."

# Значения уходят на сервер через stdin, а не в командной строке: так их не
# видно в списке процессов. Старая версия файла остаётся рядом с правами 600.
printf 'CREEM_API_KEY=%s\nCREEM_WEBHOOK_SECRET=%s\nCREEM_PRODUCT_STARTER=%s\nCREEM_PRODUCT_GROWTH=%s\nCREEM_PRODUCT_SCALE=%s\n' \
  "$KEY" "$SECRET" "$STARTER" "$GROWTH" "$SCALE" \
  | ssh -i "$SSH_KEY" -o BatchMode=yes "$SERVER" 'set -e
      cd /opt/answertally
      new=$(cat)
      cp -p .env.production .env.production.before-creem-live
      umask 077
      grep -v "^CREEM_" .env.production > .env.production.tmp
      printf "\n# Creem (live)\n%s\n" "$new" >> .env.production.tmp
      mv .env.production.tmp .env.production
      # Тот же образ, что уже работает, — меняются только настройки. Полная
      # выкладка тут не нужна: она тянула бы ещё и новый код.
      IMAGE_TAG=$(git rev-parse HEAD) docker compose -f docker-compose.prod.yml         --env-file .env.production up -d --no-build web > /dev/null 2>&1'
echo "4/5 Server updated and restarted."

# Подписанное служебное уведомление: сайт примет его, только если на сервере
# тот же секрет, что выдал Creem.
for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$SITE/api/health")" = 200 ] && break
  sleep 3
done
body=$(node -e "process.stdout.write(JSON.stringify({id:'evt_golive_'+Date.now(),eventType:'selfcheck.ping',created_at:Date.now(),object:{}}))")
sig=$(printf '%s' "$body" | SECRET="$SECRET" node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(require('crypto').createHmac('sha256',process.env.SECRET).update(s).digest('hex')))")
answer=$(curl -sS -X POST "$SITE/api/webhooks/creem" -H "content-type: application/json" -H "creem-signature: $sig" -d "$body")
case "$answer" in
  *'"received":true'*) echo "5/5 The site accepts live payment notifications. Done." ;;
  *) echo "5/5 The site did not accept the check: $answer"; exit 1 ;;
esac
