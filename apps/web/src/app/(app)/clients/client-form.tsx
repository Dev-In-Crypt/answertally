"use client";

import { useState } from "react";
import { normalizeDomain } from "@repo/core";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

export interface ClientFormValues {
  name: string;
  domain: string;
  industry: string;
  brandNames: string[];
  competitorNames: string[];
  isProspect: boolean;
}

/** Списки имён вводятся через запятую — самый предсказуемый ввод для агентства. */
export function parseList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Те же границы, что у `clientInput` на сервере, но с человеческим текстом:
 * иначе ошибка ловилась только сервером и до экрана доходил разбор zod.
 */
const NAME_MAX = 200;
const LIST_NAME_MAX = 100;
const LIST_MAX = 50;

function listProblem(label: string, items: string[]): string | null {
  if (items.length > LIST_MAX) {
    return `List at most ${LIST_MAX} ${label} (you have ${items.length}).`;
  }
  const tooLong = items.find((item) => item.length > LIST_NAME_MAX);
  if (tooLong) {
    return `Each of the ${label} can be at most ${LIST_NAME_MAX} characters. This one is too long: “${tooLong.slice(0, 40)}…”`;
  }
  return null;
}

/** Первая проблема формы человеческим языком или null, если всё в порядке. */
export function clientFormProblem(values: ClientFormValues): string | null {
  if (!values.name) return "Enter the client name.";
  if (values.name.length > NAME_MAX) return `The client name can be at most ${NAME_MAX} characters.`;
  // Сервер сначала приводит домен к голому хосту, поэтому и проверка — после него.
  if (!normalizeDomain(values.domain).includes(".")) return "Enter a domain, for example acme.com.";
  return (
    listProblem("brand names", values.brandNames) ??
    listProblem("competitors", values.competitorNames)
  );
}


export function ClientForm({
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
}: {
  initial?: Partial<ClientFormValues>;
  submitLabel: string;
  pending: boolean;
  error?: string | null;
  onSubmit: (values: ClientFormValues) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [domain, setDomain] = useState(initial?.domain ?? "");
  const [industry, setIndustry] = useState(initial?.industry ?? "");
  const [brandNames, setBrandNames] = useState((initial?.brandNames ?? []).join(", "));
  const [competitorNames, setCompetitorNames] = useState(
    (initial?.competitorNames ?? []).join(", "),
  );
  const [isProspect, setIsProspect] = useState(initial?.isProspect ?? false);
  const [problem, setProblem] = useState<string | null>(null);
  const shownError = problem ?? error;

  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const values = {
          name: name.trim(),
          domain: domain.trim(),
          industry: industry.trim(),
          brandNames: parseList(brandNames),
          competitorNames: parseList(competitorNames),
          isProspect,
        };
        const found = clientFormProblem(values);
        setProblem(found);
        if (!found) onSubmit(values);
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Client name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={NAME_MAX}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Domain</span>
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          required
          maxLength={255}
          placeholder="acmecrm.com"
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Industry</span>
        <input
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          maxLength={NAME_MAX}
          placeholder="B2B SaaS / CRM"
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Brand names</span>
        <span className="text-sm text-muted-foreground">
          Every way the brand is written, comma separated. Answers rarely use the exact legal name.
        </span>
        <input
          value={brandNames}
          onChange={(e) => setBrandNames(e.target.value)}
          placeholder="AcmeCRM, Acme CRM, Acme"
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Competitors</span>
        <span className="text-sm text-muted-foreground">
          Tracked alongside the client, so you can show the gap rather than a bare number.
        </span>
        <input
          value={competitorNames}
          onChange={(e) => setCompetitorNames(e.target.value)}
          placeholder="HubSpot, Pipedrive, Close"
          className={inputClass}
        />
      </label>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={isProspect}
          aria-label="Prospect (free audit)"
          onChange={(e) => setIsProspect(e.target.checked)}
          className="mt-1"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Prospect (free audit)</span>
          <span className="text-sm text-muted-foreground">
            Measured the same way as a paying client, but marked as a prospect so audits stay
            separate from delivery work.
          </span>
        </span>
      </label>

      {shownError && (
        <p role="alert" data-testid="form-error" className="text-sm text-destructive">
          {shownError}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className={buttonClass("primary", "lg", "w-fit")}
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
