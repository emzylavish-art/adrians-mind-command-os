import { useEffect, useRef, useState, type CSSProperties, type ImgHTMLAttributes } from "react";
import { getAssetUrl } from "@/lib/mind/media/storage/asset-url";

export type LazyMediaImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  /** Object key under public/ (e.g. brand/textures/frost-card-texture.webp). */
  assetKey?: string;
  /** Direct src (data:/blob:/https:) skips getAssetUrl. Path-like src uses getAssetUrl. */
  src?: string;
  /** CSS aspect-ratio to reserve space and avoid CLS. */
  aspectRatio?: string;
};

function isDirectSrc(value: string | undefined): boolean {
  if (!value) return false;
  return /^(data:|blob:|https?:\/\/|\/\/)/i.test(value);
}

/**
 * Lazy Imagine/media image: loading=lazy, decoding=async, IntersectionObserver
 * gated URL resolve via Fleet getAssetUrl (shim-safe), fixed aspect box.
 */
export function LazyMediaImage({
  assetKey,
  src,
  aspectRatio = "1",
  alt = "",
  className,
  style,
  ...rest
}: LazyMediaImageProps) {
  const ref = useRef<HTMLImageElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [resolved, setResolved] = useState<string | null>(() => (isDirectSrc(src) ? (src as string) : null));

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (isDirectSrc(src)) {
      setResolved(src as string);
      return;
    }
    const key = assetKey ?? (src ? src.replace(/^\/+/, "") : "");
    if (!key) {
      setResolved(null);
      return;
    }
    let cancel = false;
    void getAssetUrl(key)
      .then((url) => {
        if (!cancel) setResolved(url);
      })
      .catch(() => {
        if (!cancel) setResolved(`/${key.replace(/^\/+/, "")}`);
      });
    return () => {
      cancel = true;
    };
  }, [visible, assetKey, src]);

  const boxStyle: CSSProperties = {
    aspectRatio,
    display: "block",
    maxWidth: "100%",
    ...style,
  };

  return (
    <img
      ref={ref}
      src={resolved ?? undefined}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      style={boxStyle}
      {...rest}
    />
  );
}
