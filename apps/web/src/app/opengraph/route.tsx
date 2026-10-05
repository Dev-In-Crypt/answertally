import { ImageResponse } from "next/og";

/**
 * Картинка превью ссылки (LinkedIn, Slack, X, мессенджеры).
 *
 * Рисуется из разметки, без файла в репозитории: текст правится здесь же.
 * Шрифт — встроенный в next/og, сеть при сборке не нужна. На страницу
 * отчёта клиента эта картинка не попадает: там своё превью без бренда.
 */
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 14,
              background: "#4f46e5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: 40,
            }}
          >
            A
          </div>
          <div style={{ fontSize: 40 }}>Answertally</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 68, lineHeight: 1.1, maxWidth: 980 }}>
            Answer “Are we in ChatGPT?” with numbers that show their work.
          </div>
          <div style={{ fontSize: 30, color: "#475569" }}>
            AI visibility measurement and white-label reports for agencies
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
