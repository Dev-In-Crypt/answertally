import type { Metadata } from "next";
import { SITE_URL } from "@/config/site";
import { TrpcProvider } from "@/trpc/react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Answertally",
  description: "AI visibility measurement and delivery for agencies.",
  /**
   * Превью ссылки на сайт. Страница, задающая своё openGraph, заменяет его
   * целиком — так отчёт клиента остаётся без нашего бренда.
   */
  openGraph: {
    type: "website",
    siteName: "Answertally",
    images: [{ url: "/opengraph", width: 1200, height: 630, alt: "Answertally" }],
  },
  twitter: { card: "summary_large_image", images: ["/opengraph"] },
};

/**
 * Тема выставляется до первой отрисовки.
 *
 * React расставил бы класс только после гидратации, и на каждой загрузке
 * тёмная тема получала бы вспышку светлой. Скрипт крошечный и синхронный
 * именно поэтому. Ошибку он глотает: приватный режим запрещает чтение
 * localStorage, и падать из-за настройки оформления нельзя.
 *
 * Ключ называется просто `theme`, без имени продукта: этот скрипт попадает и
 * на страницу клиентского отчёта, а там имени продукта быть не должно вовсе
 * (инвариант 3). Поймано сквозным тестом на white-label.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Шрифт грузится заранее: он ставится на каждый экран, и без подсказки
          браузер узнаёт о нём только разобрав CSS.
        */}
        <link
          rel="preload"
          href="/fonts/Inter-Regular.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="antialiased">
        {/*
          Сбора ошибок здесь нет намеренно. Под этим корнем лежит и
          `/r/[token]` — страница, которую агентство отправляет своему
          клиенту; сторонний скрипт и наш ключ проекта на ней нарушили бы
          инвариант 3, а в событие попал бы сам токен доступа. Репортер
          смонтирован в `(app)/layout.tsx`, то есть только там, где сидит
          агентство. Сам компонент на `/r/` тоже не запускается — два замка
          на одну дверь здесь оправданы: цена ошибки — чужой отчёт.
        */}
        <TrpcProvider>{children}</TrpcProvider>
      </body>
    </html>
  );
}
