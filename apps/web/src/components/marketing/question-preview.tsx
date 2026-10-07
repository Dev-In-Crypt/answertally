"use client";

import Link from "next/link";
import { useState } from "react";
import { Turnstile } from "@/components/turnstile";
import { trackStep } from "@/lib/tracking";

type Prompt = { text: string; intent: string; isControl: boolean };

const INTENT_LABEL: Record<string, string> = {
  learning: "Choosing",
  comparison: "Comparing",
  purchase: "Buying",
  other: "Next-door category",
};

/**
 * Предпросмотр вопросов без регистрации. Показывает только черновик вопросов:
 * спросить их у ассистентов — уже после регистрации, в бесплатном аудите.
 */
export function QuestionPreview({ captchaSiteKey }: { captchaSiteKey: string | null }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "limit" | "error">("idle");
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [siteRead, setSiteRead] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState("busy");
    try {
      const response = await fetch("/api/preview-questions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(captchaToken ? { "x-captcha-response": captchaToken } : {}),
        },
        body: JSON.stringify({
          domain: String(form.get("domain") ?? ""),
          name: String(form.get("name") ?? ""),
          industry: String(form.get("industry") ?? ""),
          competitors: String(form.get("competitors") ?? "")
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean)
            .slice(0, 5),
        }),
      });
      // Токен одноразовый: следующая попытка получит новый.
      setCaptchaToken(null);
      if (response.status === 429) return setState("limit");
      if (!response.ok) return setState("error");
      const body = (await response.json()) as { prompts: Prompt[]; siteRead: boolean };
      setPrompts(body.prompts);
      trackStep("question_preview");
      setSiteRead(body.siteRead);
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="qp" data-testid="question-preview">
      <form className="qp-form" onSubmit={onSubmit}>
        <label>
          <span>Client website</span>
          <input name="domain" required maxLength={200} placeholder="example.com" />
        </label>
        <label>
          <span>Brand name</span>
          <input name="name" required maxLength={100} placeholder="Example" />
        </label>
        <label>
          <span>What they sell</span>
          <input name="industry" required minLength={2} maxLength={120} placeholder="olive oil" />
        </label>
        <label>
          <span>Competitors, comma-separated (optional)</span>
          <input name="competitors" maxLength={400} placeholder="Brand A, Brand B" />
        </label>
        {captchaSiteKey && <Turnstile siteKey={captchaSiteKey} onToken={setCaptchaToken} />}
        <button
          className="btn primary"
          type="submit"
          disabled={state === "busy" || (Boolean(captchaSiteKey) && !captchaToken)}
        >
          {state === "busy" ? "Reading the site and drafting…" : "Show the questions"}
        </button>
      </form>

      {state === "limit" && (
        <p className="small" role="status">
          That is the free preview limit for today. <Link href="/signup">Create a workspace</Link> to
          draft questions for every client.
        </p>
      )}
      {state === "error" && (
        <p className="small" role="status">
          Something went wrong drafting the questions. Try again in a minute.
        </p>
      )}

      {state === "done" && (
        <div className="qp-result" role="status">
          <p className="small muted">
            {siteRead
              ? "Drafted from the client’s homepage, its category and competitors."
              : "Drafted from the category and competitors: the homepage could not be read."}{" "}
            The audit asks each one several times on ChatGPT and Perplexity and counts who gets named.
          </p>
          <ol className="qp-list">
            {prompts.map((prompt) => (
              <li key={prompt.text}>
                <span className="qp-intent">{prompt.isControl ? "Control" : (INTENT_LABEL[prompt.intent] ?? "Other")}</span>
                {prompt.text}
              </li>
            ))}
          </ol>
          <div className="ctas">
            <Link className="btn primary" href="/signup">
              See who ChatGPT names for these, free
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
