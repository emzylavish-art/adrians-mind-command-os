import { useEffect } from "react";
import { applyMotionChoice, MOTION_KEY, readMotionChoice } from "@/lib/mind/apple-motion";

export function AppleMotionHost() {
  useEffect(() => {
    const apply = () => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(MOTION_KEY);
      } catch {
        stored = null;
      }
      const systemReduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      applyMotionChoice(document, readMotionChoice(stored, systemReduce));
    };
    apply();
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener("change", apply);
    window.addEventListener("amcos-motion", apply);
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener("amcos-motion", apply);
    };
  }, []);
  return null;
}
