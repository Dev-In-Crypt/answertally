"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { adVendors, TRACKING, TRACKING_ENABLED } from "@/config/tracking";
import { OPEN_CONSENT_EVENT, readConsent, writeConsent, type Consent } from "@/lib/consent";

/**
 * Баннер согласия и загрузка рекламных меток.
 *
 * Метки грузятся только после «Accept all» и только заданные в настройках.
 * «Reject all» и молчание не грузят ничего. Обе кнопки равны по виду: отказ
 * не должен быть спрятан. Выбор можно изменить из подвала.
 *
 * Монтируется только в обрамлении витрины: страница клиентского отчёта и
 * внутренность продукта метками не затрагиваются.
 */

type Fn = (...args: unknown[]) => void;

interface TagWindow {
  dataLayer?: unknown[];
  gtag?: Fn;
  fbq?: Fn & {
    callMethod?: Fn;
    queue?: unknown[];
    push?: unknown;
    loaded?: boolean;
    version?: string;
  };
  _fbq?: unknown;
  _linkedin_data_partner_ids?: string[];
  lintrk?: Fn & { q?: unknown[] };
}

function addScript(src: string): void {
  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}

let loaded = false;

function loadTags(): void {
  if (loaded) return;
  loaded = true;
  const w = window as unknown as TagWindow;

  if (TRACKING.googleAdsId) {
    const layer: unknown[] = (w.dataLayer = w.dataLayer ?? []);
    // Google ждёт в очереди именно объект `arguments`, а не массив.
    w.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      layer.push(arguments);
    };
    w.gtag("js", new Date());
    w.gtag("config", TRACKING.googleAdsId);
    addScript(`https://www.googletagmanager.com/gtag/js?id=${TRACKING.googleAdsId}`);
  }

  if (TRACKING.metaPixelId) {
    if (!w.fbq) {
      const fbq = function (...args: unknown[]) {
        if (fbq.callMethod) fbq.callMethod(...args);
        else fbq.queue?.push(args);
      } as NonNullable<TagWindow["fbq"]>;
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = "2.0";
      fbq.queue = [];
      w.fbq = fbq;
      w._fbq = fbq;
    }
    addScript("https://connect.facebook.net/en_US/fbevents.js");
    w.fbq("init", TRACKING.metaPixelId);
    w.fbq("track", "PageView");
  }

  if (TRACKING.linkedinPartnerId) {
    w._linkedin_data_partner_ids = [TRACKING.linkedinPartnerId];
    const lintrk = function (...args: unknown[]) {
      lintrk.q?.push(args);
    } as NonNullable<TagWindow["lintrk"]>;
    lintrk.q = [];
    w.lintrk = lintrk;
    addScript("https://snap.licdn.com/li.lms-analytics/insight.min.js");
  }
}

export function ConsentManager() {
  const pathname = usePathname();
  const [decision, setDecision] = useState<Consent | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const firstPath = useRef(pathname);

  useEffect(() => {
    if (!TRACKING_ENABLED) return;
    const stored = readConsent();
    setDecision(stored);
    setOpen(stored === null);
    setReady(true);
    if (stored === "granted") loadTags();

    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
  }, []);

  // Переходы внутри сайта не перезагружают страницу: просмотр шлём сами.
  useEffect(() => {
    if (decision !== "granted" || pathname === firstPath.current) return;
    firstPath.current = pathname;
    const w = window as unknown as TagWindow;
    w.gtag?.("event", "page_view");
    w.fbq?.("track", "PageView");
  }, [pathname, decision]);

  function choose(value: Consent) {
    writeConsent(value);
    setDecision(value);
    setOpen(false);
    if (value === "granted") loadTags();
    // Отозванное согласие вступает в силу при следующей загрузке страницы:
    // уже выполненный сторонний скрипт из памяти не выгрузить.
    if (value === "denied" && loaded) window.location.reload();
  }

  if (!TRACKING_ENABLED || !ready || !open) return null;

  return (
    <div data-surface="marketing" className="mk">
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby="consent-title"
        className="consent"
        data-testid="consent-banner"
      >
        <p id="consent-title" className="consent-title">
          Cookies for ad measurement
        </p>
        <p className="consent-text">
          With your OK we load measurement tags from {adVendors().join(", ")} to see which ads bring
          people to this site. They set cookies. Nothing loads until you choose, and you can change
          your mind any time from “Cookie settings” in the footer.{" "}
          <Link href="/legal/cookies">Cookie policy</Link>
        </p>
        <div className="consent-actions">
          <button type="button" className="btn secondary" onClick={() => choose("denied")}>
            Reject all
          </button>
          <button type="button" className="btn secondary" onClick={() => choose("granted")}>
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}

/** Ссылка в подвале: открывает выбор заново. Без меток её нет — менять нечего. */
export function CookieSettingsLink() {
  if (!TRACKING_ENABLED) return null;
  return (
    <button
      type="button"
      className="foot-link-button"
      onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))}
    >
      Cookie settings
    </button>
  );
}
