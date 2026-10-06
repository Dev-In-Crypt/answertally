/**
 * Структурированные данные для поисковиков и ИИ-ассистентов.
 *
 * «<» экранируется: данные вставляются в тег script, и строка с `</script>`
 * внутри закрыла бы его раньше времени.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
