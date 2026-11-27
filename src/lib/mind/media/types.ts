import type { ImagePreparationReceipt, ImageEditLineage } from "./image-metadata.ts";
/** OpenAI-compatible multimodal content parts for chat completions. */

export type TextContentPart = { type: "text"; text: string };

export type ImageUrlContentPart = {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
};

export type MultimodalContentPart = TextContentPart | ImageUrlContentPart;

export type ChatContent = string | MultimodalContentPart[];

export type ImageAttachment = {
  preparation?: ImagePreparationReceipt;
  lineage?: ImageEditLineage;
  origin?: "attached" | "camera" | "generated" | "edited";
  /** data:image/...;base64,... */
  dataUrl: string;
  name?: string;
  /** MIME subtype hint, e.g. jpeg / png / webp */
  mime?: string;
  assetId?: string;
  parentAssetId?: string;
  operationId?: string;
  createdAt?: string;
  editPrompt?: string;
  preferred?: boolean;
};

export const MAX_IMAGE_EDGE = 2048;
export const MAX_IMAGES_PER_TURN = 4;
/** Soft cap for a single data-URL payload (chars). Larger images should be downscaled client-side. */
export const MAX_DATA_URL_CHARS = 1_800_000;
