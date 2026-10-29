"use client";

import { useEffect } from "react";
import { trackStep } from "@/lib/tracking";

/**
 * Читают ли витрину. Umami считает время только между двумя страницами:
 * визит на одну страницу для него длится 0 секунд и считается отказом, даже
 * если её читали три минуты. Два события отвечают на это прямо: «пробыл 30
 * секунд» и «долистал до середины». Каждое — один раз за страницу.
 */
export function EngagementEvents() {
  useEffect(() => {
    const timer = window.setTimeout(() => trackStep("engaged_30s"), 30_000);
    let half = false;
    const onScroll = () => {
      const doc = document.documentElement;
      if (!half && window.scrollY + window.innerHeight >= doc.scrollHeight / 2) {
        half = true;
        trackStep("read_half");
        window.removeEventListener("scroll", onScroll);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  return null;
}
