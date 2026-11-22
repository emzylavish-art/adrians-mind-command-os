import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.env.ADRIAN_ENGINE_ROOT;
const cli = process.env.ADRIAN_TRANSCRIBE;
const ffmpeg = process.env.ADRIAN_FFMPEG;
const model = process.env.ADRIAN_WHISPER_MODEL;
const port = 4196;

function allowedOrigin(origin) {
  if (!origin) return "http://127.0.0.1:41731";
  try {
    const url = new URL(origin);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return origin;
  } catch {
    return "";
  }
  return "";
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(stderr.trim() || `${command} exited ${code}`));
    });
  });
}

const server = createServer(async (request, response) => {
  const origin = allowedOrigin(request.headers.origin);
  if (origin) response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("vary", "Origin");
  if (request.method === "OPTIONS") {
    response.writeHead(origin ? 204 : 403);
    response.end();
    return;
  }
  if (request.method !== "POST" || request.url !== "/handy-stt") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, google: false, error: "Not the Handy Whisper route." }));
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const audio = Buffer.concat(chunks);
  const dir = await mkdtemp(join(tmpdir(), "handy-"));
  const raw = join(dir, "capture.bin");
  const wav = join(dir, "capture.wav");
  const out = join(dir, "transcript.txt");
  try {
    if (!root || !cli || !ffmpeg || !model) throw new Error("Handy is not packed with this application.");
    if (audio.length < 32) throw new Error("The capture was empty.");
    await writeFile(raw, audio);
    await run(ffmpeg, ["-y", "-i", raw, "-ar", "16000", "-ac", "1", wav]);
    await run(cli, ["-m", model, "-l", "en", "-q", "--timestamps", "none", wav, "-o", out]);
    const text = (await readFile(out, "utf8")).replace(/\s+/g, " ").trim();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: Boolean(text),
      text,
      engine: "transcribe.cpp",
      model: "whisper-tiny.en",
      source: "https://github.com/handy-computer/transcribe.cpp",
      google: false,
      speak: false,
      error: text ? undefined : "Handy heard no words.",
    }));
  } catch (error) {
    response.writeHead(422, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: false,
      text: "",
      google: false,
      speak: false,
      error: error instanceof Error ? error.message : "Whisper did not transcribe.",
    }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`handy whisper listening on ${port}`);
});
