import { useEffect } from "react";
import { applyAppleMotion } from "@/lib/mind/apple-motion";

export function AppleMotionHost() {
  useEffect(() => {
    applyAppleMotion(document);
  }, []);
  return null;
}
