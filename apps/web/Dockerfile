# Образ веб-приложения.
#
# Три стадии: зависимости, сборка, рантайм. Рантайм получает только
# standalone-вывод Next — в нём нет ни Playwright, ни инструментов
# разработки, ни исходников.
#
# Сборка герметична: сеть на этом этапе не используется (в окружении
# перехват TLS, и любой fetch на сборке падает). Шрифты и ассеты локальные.

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /repo

# ---------- Зависимости ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/pipeline/package.json packages/pipeline/
# Браузер Playwright в образ не тянем: его сборка под glibc и на Alpine не
# запустится. PDF печатает системный Chromium из рантайм-стадии.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN pnpm install --frozen-lockfile

# ---------- Сборка ----------
FROM deps AS build
COPY . .
# Сборке Next нужны публичные переменные: они попадают в бандл. Секреты сюда
# не передаются — они читаются в рантайме.
#
# Перечислены все NEXT_PUBLIC_*, которые есть в продукте. Next подставляет их
# значения прямо в код на сборке — и в клиентский бандл, и в серверный. Не
# переданная сюда переменная окажется пустой даже если задать её в окружении
# контейнера, и выглядеть это будет как «настройка не работает». Смена любой
# из них требует пересборки образа — об этом сказано в docs/deploy.md.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SENTRY_DSN
# Домен, на котором агентство отдаёт отчёты своим клиентам (white-label).
ARG NEXT_PUBLIC_REPORT_HOST
# Контакт продаж на лендинге. Пусто — кнопки нет, звонок не обещается.
ARG NEXT_PUBLIC_SALES_EMAIL
ARG NEXT_PUBLIC_SALES_URL
ARG NEXT_PUBLIC_SALES_LABEL
# Рекламные метки витрины. Пусто — метки не грузятся и баннера нет.
ARG NEXT_PUBLIC_GOOGLE_ADS_ID
ARG NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL
ARG NEXT_PUBLIC_META_PIXEL_ID
ARG NEXT_PUBLIC_LINKEDIN_PARTNER_ID
ARG NEXT_PUBLIC_LINKEDIN_SIGNUP_CONVERSION_ID
# Аналитика без cookies (Umami). Пусто — счётчик не грузится.
ARG NEXT_PUBLIC_UMAMI_WEBSITE_ID
# Standalone-вывод включается только здесь: на Windows он ломает локальную
# сборку, потому что раскладывается симлинками.
ENV DOCKER_BUILD=1 NEXT_TELEMETRY_DISABLED=1
# Заглушки живут только на время этой команды и не остаются в образе.
# Подключений при сборке не открывается — Next лишь выполняет модули, собирая
# данные страниц, а строки нужны фабрикам. Настоящие значения — в рантайме.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    BETTER_AUTH_SECRET=build-only-never-used-at-runtime \
    pnpm --filter @repo/web run build

# ---------- Рантайм ----------
FROM node:22-alpine AS runner
WORKDIR /app
# HOSTNAME задан явно: standalone-сервер Next берёт адрес привязки из этой
# переменной, а Docker подставляет в неё id контейнера. Тогда сервер слушает
# только внешний адрес, снаружи всё работает, а проверка живости изнутри
# ходит на 127.0.0.1 и не достучится — контейнер вечно unhealthy.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

# Chromium для печати отчёта в PDF: печатает веб-процесс, открывая ту же
# публичную страницу, что видит клиент. Без браузера кнопка PDF в бою
# падала. Шрифт ttf-freefont — запасной для символов вне Inter; сами шрифты
# отчёта страница грузит со своего сервера.
RUN apk add --no-cache chromium nss freetype harfbuzz ttf-freefont
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser     INTERNAL_APP_URL=http://127.0.0.1:3000

# Непривилегированный пользователь: процессу приложения root не нужен.
#
# uid и gid совпадают с воркером намеренно: контейнеры делят том с сырыми
# ответами, и разные владельцы означали бы, что один из них не может прочитать
# то, что записал другой.
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs

# В public лежит только шрифт: он обязан ехать в образ, иначе продукт в бою
# нарисуется системным и будет выглядеть иначе, чем всё, что мы проверяли.
# Файлы агентств туда не попадают — они живут в хранилище.
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static

# Каталог хранилища создаётся до монтирования тома и с нужным владельцем:
# свежий именованный том наследует права точки монтирования из образа, иначе
# процесс без root не сможет в него писать.
RUN mkdir -p /data/storage && chown -R nextjs:nodejs /data/storage

USER nextjs
EXPOSE 3000

# /api/health отвечает 503, пока недоступна база: живость меряется по тому,
# может ли инстанс отдать отчёт, а не по тому, поднялся ли процесс.
# start-period с запасом: на маленькой машине первый запуск после сборки
# занимает заметно больше десяти секунд, а ранний красный статус пугает
# человека, который в этот момент смотрит на `compose ps`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node запускается напрямую: standalone-сервер Next сам обрабатывает SIGTERM
# и закрывает соединения. Chromium для печати PDF оставляет за собой дочерние
# процессы, поэтому контейнер поднимается с init-процессом (см. compose).
CMD ["node", "apps/web/server.js"]
