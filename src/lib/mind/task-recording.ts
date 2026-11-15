export type TaskRecorder = {
  start: (stream: MediaStream) => void;
  active: () => boolean;
  elapsed: () => number;
  stop: () => Promise<Blob | null>;
};

export function recordingEndsWithDocument(event: { type: string; persisted?: boolean }): boolean {
  return event.type === "pagehide" || event.type === "beforeunload";
}

export function createTaskRecorder(): TaskRecorder {
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let started = 0;
  return {
    start(stream) {
      chunks = [];
      started = Date.now();
      const mime = typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.start(1000);
    },
    active() {
      return recorder?.state === "recording";
    },
    elapsed() {
      return started ? Date.now() - started : 0;
    },
    stop() {
      const current = recorder;
      if (!current || current.state === "inactive") return Promise.resolve(null);
      return new Promise((resolve) => {
        current.onstop = () => {
          recorder = null;
          started = 0;
          resolve(new Blob(chunks, { type: current.mimeType || "audio/webm" }));
        };
        current.stop();
      });
    },
  };
}
