/**
 * Wrap dictation start so hung mint/mic cannot stick forever.
 * Does not edit src/lib/mind/voice/ — callers stop via listen({mode:"stop"}).
 */
export const DICTATE_MINT_TIMEOUT_MS = 10_000;
export const DICTATE_MIC_TIMEOUT_MS = 8_000;

export function withDictateTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
