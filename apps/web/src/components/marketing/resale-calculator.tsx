"use client";

import { useId, useState } from "react";

/**
 * Калькулятор перепродажи на странице тарифов.
 *
 * Только арифметика на числах, которые вводит агентство: выручка от услуги и
 * цена плана, который покрывает столько клиентов. Маржу не обещает и рыночную
 * ставку не подставляет — значения по умолчанию подписаны как условные.
 *
 * Планы и тексты приходят пропсами с сервера: клиентский бандл не должен
 * тянуть `@repo/core` целиком ради трёх чисел.
 */

export interface CalculatorPlan {
  id: string;
  name: string;
  priceUsd: number;
  clientLimit: number;
}

const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function ResaleCalculator({
  plans,
  title,
  intro,
  caveat,
  defaultPriceUsd,
  defaultClients,
}: {
  plans: CalculatorPlan[];
  title: string;
  intro: string;
  caveat: string;
  defaultPriceUsd: number;
  defaultClients: number;
}) {
  const id = useId();
  const [price, setPrice] = useState(String(defaultPriceUsd));
  const [clients, setClients] = useState(String(defaultClients));

  const priceValue = clamp(Number(price), 0, 1_000_000);
  const clientsValue = Math.round(clamp(Number(clients), 0, 10_000));
  const revenue = priceValue * clientsValue;

  // Самый маленький план, в который помещается столько клиентов.
  const sorted = [...plans].sort((a, b) => a.clientLimit - b.clientLimit);
  const plan = clientsValue > 0 ? (sorted.find((p) => p.clientLimit >= clientsValue) ?? null) : null;
  const largest = sorted.at(-1);
  const planText = plan
    ? `${plan.name} · ${usd(plan.priceUsd)}`
    : clientsValue > 0
      ? `No listed plan above ${largest?.clientLimit ?? 0} clients yet`
      : "–";
  const share = plan && revenue > 0 ? Math.round((plan.priceUsd / revenue) * 100) : null;

  return (
    <div className="card calc" data-testid="resale-calculator">
      <div className="calc-in">
        <h3 className="h4">{title}</h3>
        <p className="small">{intro}</p>
        <label className="calc-field" htmlFor={`${id}-price`}>
          <span>What you would charge one client, per month (USD)</span>
          <input
            id={`${id}-price`}
            type="number"
            inputMode="numeric"
            min={0}
            step={50}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            data-testid="calc-price"
          />
        </label>
        <label className="calc-field" htmlFor={`${id}-clients`}>
          <span>Clients who take it</span>
          <input
            id={`${id}-clients`}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={clients}
            onChange={(e) => setClients(e.target.value)}
            data-testid="calc-clients"
          />
        </label>
        <p className="label">Starting values are illustrative. Replace them with your own.</p>
      </div>

      <div className="calc-out" aria-live="polite">
        <div className="calc-row">
          <span>Revenue from the service, per month</span>
          <b data-testid="calc-revenue">{usd(revenue)}</b>
        </div>
        <div className="calc-row">
          <span>
            {plan
              ? `Plan that covers ${clientsValue} ${clientsValue === 1 ? "client" : "clients"}`
              : "Plan"}
          </span>
          <b data-testid="calc-plan">{planText}</b>
        </div>
        {share !== null && (
          <div className="calc-row">
            <span>The plan as a share of that revenue</span>
            <b data-testid="calc-share">{share}%</b>
          </div>
        )}
        <p className="basis">{caveat}</p>
      </div>
    </div>
  );
}
