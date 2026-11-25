const { readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");

function checkWindowsResources(resources) {
  const required = [
    "app.asar", "app-server/server/index.mjs", "app-server/server/_libs/pglite.data",
    "app-server/server/_libs/pglite.wasm", "app-server/server/_libs/initdb.wasm",
    "engines/node.exe", "engines/ffmpeg.exe", "engines/transcribe-cli.exe",
    "engines/handy-server.mjs", "engines/opus-server.mjs", "engines/local-model-runner.mjs",
    "engines/models/whisper-tiny.en-Q8_0.gguf", "engines/adrian-agents/runtime.mjs",
    "companion/Pair-Now.ps1", "companion/MindAgent.ps1", "companion/KimiAcpClient.mjs",
  ];
  const present = file => {
    const stat = statSync(file, { throwIfNoEntry: false });
    return stat?.isFile() && stat.size > 0;
  };
  const missing = required.filter(item => !present(join(resources, item)));
  for (const [directory, pattern] of [
    ["engines/local-model/models", /\.gguf$/i],
    ["models/jeff", /\.(?:bin|gguf|onnx|safetensors)$/i],
  ]) {
    const location = join(resources, directory);
    const files = statSync(location, { throwIfNoEntry: false })?.isDirectory() ? readdirSync(location, { recursive: true }) : [];
    if (!files.some(file => pattern.test(file) && present(join(location, file)))) missing.push(directory + " (model weights)");
  }
  if (missing.length) throw Error("Full Windows package is missing required resources: " + missing.join(", "));
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName === "win32") checkWindowsResources(join(context.appOutDir, "resources"));
};
module.exports.checkWindowsResources = checkWindowsResources;
