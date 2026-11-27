import { memo, useCallback, useRef } from "react";
import { AnswerTabs, MessageBody } from "./message-body.tsx";

/** Historical text bodies bail out when a separate live reply or composer changes. */
export const MemoAnswerTabs = memo(AnswerTabs);
export const MemoMessageBody = memo(MessageBody);

export function useMessageMediaActions(actions: {
  onEditImagine: (src: string) => void;
  onSaveImage: (src: string, alt: string) => void;
  onDownloadImage: (src: string, alt: string) => void;
}) {
  const latest = useRef(actions);
  latest.current = actions;
  const editImage = useCallback((src: string) => latest.current.onEditImagine(src), []);
  const saveImage = useCallback((src: string, alt: string) => latest.current.onSaveImage(src, alt), []);
  const downloadImage = useCallback((src: string, alt: string) => latest.current.onDownloadImage(src, alt), []);
  return { editImage, saveImage, downloadImage };
}
