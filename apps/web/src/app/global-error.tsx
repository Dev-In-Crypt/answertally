"use client";

import { useEffect } from "react";
import { reportClientError } from "@/components/client-error-reporting";

/**
 * Последний рубеж: упал сам корневой layout, и обычный `error.tsx` не сработал.
 *
 * Экран объясняет, что случилось, вместо белой страницы, и отправляет ошибку
 * в Sentry, если клиентский DSN задан. Next требует здесь собственные html/body.
 *
 * Стили — только inline: этот экран подменяет корневой layout, и globals.css
 * сюда не доезжает (известная регрессия Next, vercel/next.js#70553). Классы
 * Tailwind дали бы голый текст Times на белом.
 *
 * Текст нейтральный, без имени продукта: экран видит и клиент агентства на
 * `/r/<токен>` (инвариант 3).
 */

// Нейтральный slate: индиго продукта на отчёте агентства — тоже след поставщика.
const colors = { text: "#0f172a", muted: "#64748b" };

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    /**
     * Общий вход с обычным репортером: он сам решает, можно ли отправлять
     * (на `/r/*` — нельзя, инвариант 3), и поднимает SDK, если тот ещё не
     * поднят. Этот экран подменяет корневой layout целиком, компонент здесь
     * не смонтирован, а падение могло случиться до первой отрисовки —
     * прямой `captureException` ушёл бы в пустоту.
     */
    void reportClientError(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#ffffff",
          color: colors.text,
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <main
          style={{
            boxSizing: "border-box",
            maxWidth: 448,
            minHeight: "100vh",
            margin: "0 auto",
            padding: "0 24px",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "center",
            gap: 16,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em" }}>
            This page could not be loaded
          </h1>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: colors.muted }}>
            Something went wrong while opening it. Try again in a moment.
          </p>
          {error.digest && (
            <p style={{ margin: 0, fontSize: 12, color: colors.muted, fontVariantNumeric: "tabular-nums" }}>
              Reference: {error.digest}
            </p>
          )}
          {/*
            Перезагрузка, а не reset(): упал серверный layout, и перерисовка
            на клиенте показала бы ту же ошибку.
          */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              height: 40,
              padding: "0 16px",
              border: 0,
              borderRadius: 8,
              background: colors.text,
              color: "#ffffff",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
