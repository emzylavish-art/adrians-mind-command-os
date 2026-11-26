import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { consequentialSpeechRefusal } from "./frontier-2031.ts";
import { destructiveSpeechRefusal } from "./reversibility.ts";
import { resolveXaiInferenceApiKey } from "./media/xai-key.ts";
import { executePcPlan, planPcRequest, type PcAction, type PcExecution } from "./pc-action-plan.ts";
import { analyzePcScreenshot, boundedOperation, type VisionPolicy } from "./pc-vision.ts";
import { currentLocalDestination, nativeCloudAllowed } from "./native-policy.server.ts";

const execFileAsync = promisify(execFile);

export function adrianPcEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ADRIAN_PC === "1" && !env.VERCEL;
}

export function buttonMatchDecision(names: string[]): { click: boolean; output: string } {
  const matches = names.map(name => name.trim()).filter(Boolean);
  return { click: false, output: matches.length === 0 ? "No button matched. Nothing was clicked." : matches.length === 1 ? `Exactly one button matched: ${matches[0]}. Nothing was clicked. Use an explicit click with its window name.` : `${matches.length} buttons matched. Nothing was clicked.` };
}
function insideRoot(root: string, target: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep) ? resolved : null;
}
function psLiteral(value: string): string { return "'" + value.replace(/'/g, "''") + "'"; }

type PcInput = {
  text: string; halted: boolean; recheckHalt?: () => boolean | Promise<boolean>;
  root?: string; platform?: NodeJS.Platform; deviceId?: string; signal?: AbortSignal;
  authorize?: (action: PcAction) => boolean | Promise<boolean>;
  executeAction?: (action: PcAction) => Promise<{ state: "completed" | "verified" | "failed" | "blocked" | "unconfirmed"; output: string; attempted?: boolean }>;
  findButtons?: (name: string, window?: string) => Promise<string[]>;
  clickButton?: (name: string, window: string) => Promise<boolean>;
  captureScreen?: (signal?: AbortSignal) => Promise<Buffer | null>;
  readImage?: (png: Buffer, signal?: AbortSignal) => Promise<string>;
  visionPolicy?: VisionPolicy;
};
export async function runAdrianPc(input: PcInput): Promise<PcExecution> {
  const plan = planPcRequest(input.text);
  const refusal = consequentialSpeechRefusal(input.text) || destructiveSpeechRefusal(input.text);
  if (refusal) { plan.error = refusal; plan.recognized = true; }
  const root = path.resolve(input.root || path.join(os.homedir(), "Desktop"));
  const platform = input.platform || process.platform;
  const halted = async () => input.halted || !!await input.recheckHalt?.();
  return executePcPlan(plan, {
    deviceId: input.deviceId || currentLocalDestination().deviceId, halted,
    authorize: input.authorize, signal: input.signal,
    execute: input.executeAction || (async action => {
      const blocked = (output: string) => ({ state: "blocked" as const, output, attempted: false });
      if (action.kind === "worker") return blocked("Closing the renderer is different from keeping the desktop process running. No independent worker was started.");
      if (action.kind === "vision") return understandScreenshot(platform, input, halted);
      const portable = ["list_files", "read_file", "write_file", "make_folder", "run_command"];
      if (platform !== "win32" && !portable.includes(action.kind) && !(action.kind === "find_button" && input.findButtons) && !(action.kind === "invoke_button" && input.findButtons && input.clickButton)) return blocked("This computer is not Windows. The screen was not captured; nothing was clicked or typed.");
      const [first, second, third, fourth] = action.args;
      if (["read_file", "write_file", "make_folder"].includes(action.kind) && !await safeOwnerPath(root, first)) return blocked("That path is outside the owner folder or crosses a symbolic link. Nothing was read, written, or created.");
      let output = "";
      switch (action.kind) {
        case "list_files": output = await listOwnerFolder(root); break;
        case "read_file": output = await readOwnerFile(root, first); break;
        case "write_file": output = await writeOwnerFile(root, first, second); break;
        case "make_folder": output = await makeOwnerFolder(root, first); break;
        case "run_command": output = await runOwnerCommand(root, platform, first); break;
        case "move_pointer": output = await movePointer(platform); break;
        case "click": output = await clickPointer(platform, Number(first), Number(second)); break;
        case "right_click": output = await windowsButton(Number(first), Number(second), "right"); break;
        case "double_click": output = await windowsButton(Number(first), Number(second), "double"); break;
        case "scroll": output = await windowsScroll(first.toLowerCase() === "up" ? 120 : -120); break;
        case "drag": output = await windowsDrag(Number(first), Number(second), Number(third), Number(fourth)); break;
        case "type_text": case "dictation": output = await typeText(platform, first); break;
        case "capture_screen": output = await inspectScreen(root, platform); break;
        case "open_browser": output = await openBrowser(platform, first); break;
        case "launch_app": output = await launchApp(platform, first); break;
        case "list_windows": output = await windowsCommand(platform, undefined); break;
        case "focus_window": output = await windowsCommand(platform, first); break;
        case "window_action": output = await windowsFrame(first, second); break;
        case "list_monitors": output = await windowsMonitors(); break;
        case "accessibility": output = await windowsAccessibility(); break;
        case "find_button": {
          const names = input.findButtons ? await input.findButtons(first) : await windowsFindButtons(first);
          return { state: "completed", output: buttonMatchDecision(names).output, attempted: true };
        }
        case "invoke_button": {
          const names = input.findButtons ? await input.findButtons(first, second) : await windowsFindButtons(first, second);
          if (names.length !== 1 || names[0] !== first) return blocked("The exact button is not unique in the selected window. Nothing was clicked.");
          if (await halted() || input.signal?.aborted || (input.authorize && !await input.authorize(action))) return blocked("The action lost its current permission before invocation. Nothing was clicked.");
          const clicked = input.clickButton ? await input.clickButton(first, second) : await windowsInvokeButton(first, second);
          return { state: clicked ? "completed" : "unconfirmed", attempted: true, output: clicked ? `Windows acknowledged the requested ${first} invocation in ${second}. The resulting application state is not independently verified.` : "Windows did not confirm the button invocation. Inspect the selected window before retrying." };
        }
      }
      const failed = /(?:could not|did not|not a file|outside the owner|too large|not on this computer)/i.test(output);
      return { state: failed ? action.permission === "modify" ? "unconfirmed" : "failed" : "completed", output, attempted: true };
    }),
  });
}

async function understandScreenshot(platform: NodeJS.Platform, input: PcInput, halted: () => Promise<boolean>): Promise<{ state: "completed" | "blocked" | "failed" | "unconfirmed"; output: string; attempted: boolean }> {
  const policy = input.visionPolicy;
  if (policy?.allowExternalImage !== true || typeof policy.model !== "string" || !policy.model || policy.captureScope !== "primary-screen" || !nativeCloudAllowed()) return { state: "blocked", attempted: false, output: "Select a vision model and explicitly allow this primary-screen image to leave the device. Local-only mode prohibits external vision. No screenshot was sent." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), typeof policy.timeoutMs === "number" && Number.isFinite(policy.timeoutMs) ? Math.min(60_000, Math.max(1, policy.timeoutMs)) : 20_000);
  const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
  let providerStarted = false;
  let captureStarted = false;
  try {
    if (await halted() || signal.aborted) return { state: "blocked", attempted: false, output: "Screenshot processing was stopped before capture. No provider was called." };
    captureStarted = true;
    const png = await boundedOperation(() => input.captureScreen ? input.captureScreen(signal) : captureScreenPng(platform, signal), signal);
    if (!png || png.length < 32) return { state: "failed", attempted: true, output: "The screen was not captured. No vision model was called." };
    if (await halted() || signal.aborted || !nativeCloudAllowed()) return { state: "blocked", attempted: true, output: "Screenshot permission changed after capture. No image was sent to a provider." };
    if (input.readImage) {
      providerStarted = true;
      const text = (await boundedOperation(() => input.readImage!(png, signal), signal)).trim();
      return { state: text ? "completed" : "failed", attempted: true, output: text ? `Vision reading from injected adapter (live provider unverified): ${text}` : "The vision adapter returned no reading. Nothing was invented." };
    }
    const result = await analyzePcScreenshot(png, resolveXaiInferenceApiKey() || "", policy, { signal, authorize: async () => !await halted() && nativeCloudAllowed() });
    return { state: result.state === "canceled" ? "blocked" : result.state, output: result.output, attempted: captureStarted || result.attempted };
  } catch { return { state: providerStarted ? "unconfirmed" : "failed", attempted: captureStarted, output: providerStarted ? "Screenshot processing stopped after provider dispatch. Its external outcome is unknown; no automatic retry started." : "Screen capture was canceled, failed, or timed out. No vision model was called." }; }
  finally { clearTimeout(timer); controller.abort(); }
}

export async function readScreenshotWithGrok(png: Buffer, apiKey: string, model = "", policy?: Partial<VisionPolicy>): Promise<string> {
  return (await analyzePcScreenshot(png, apiKey, { model, allowExternalImage: policy?.allowExternalImage === true, allowFallback: policy?.allowFallback === true, fallbackModel: policy?.fallbackModel, captureScope: "primary-screen", timeoutMs: policy?.timeoutMs })).output;
}

async function windowsMonitors(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $_.DeviceName }"], { timeout: 8000, windowsHide: true });
    return String(stdout || "").trim() || "Windows returned no monitors.";
  } catch { return "Windows did not list monitors."; }
}

async function windowsButton(x: number, y: number, kind: "right" | "double"): Promise<string> {
  const down = kind === "right" ? 8 : 2;
  const up = kind === "right" ? 16 : 4;
  const second = kind === "double" ? `[AdrianClick]::mouse_event(2,0,0,0,[System.UIntPtr]::Zero); [AdrianClick]::mouse_event(4,0,0,0,[System.UIntPtr]::Zero);` : "";
  const script = `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class AdrianClick { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, System.UIntPtr e); }'; [AdrianClick]::SetCursorPos(${x}, ${y}); [AdrianClick]::mouse_event(${down},0,0,0,[System.UIntPtr]::Zero); [AdrianClick]::mouse_event(${up},0,0,0,[System.UIntPtr]::Zero); ${second}`;
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { timeout: 8000, windowsHide: true });
    return `Adrian sent a ${kind} click at ${x},${y}.`;
  } catch {
    return "Windows did not click.";
  }
}

async function windowsScroll(delta: number): Promise<string> {
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class AdrianWheel { [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, System.UIntPtr e); }'; [AdrianWheel]::mouse_event(2048,0,0,${delta},[System.UIntPtr]::Zero)`], { timeout: 8000, windowsHide: true });
    return `Adrian scrolled ${delta > 0 ? "up" : "down"}.`;
  } catch {
    return "Windows did not scroll.";
  }
}

async function windowsDrag(x1: number, y1: number, x2: number, y2: number): Promise<string> {
  const script = `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class AdrianDrag { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, System.UIntPtr e); }'; [AdrianDrag]::SetCursorPos(${x1}, ${y1}); [AdrianDrag]::mouse_event(2,0,0,0,[System.UIntPtr]::Zero); [AdrianDrag]::SetCursorPos(${x2}, ${y2}); [AdrianDrag]::mouse_event(4,0,0,0,[System.UIntPtr]::Zero)`;
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { timeout: 8000, windowsHide: true });
    return `Adrian dragged from ${x1},${y1} to ${x2},${y2}.`;
  } catch {
    return "Windows did not drag.";
  }
}

async function windowsFrame(action: string, title: string): Promise<string> {
  const show = action === "minimize" ? 6 : action === "maximize" ? 3 : 0;
  const script = action === "close"
    ? `Get-Process | Where-Object { $_.MainWindowTitle -eq ${psLiteral(title)} } | ForEach-Object { $_.CloseMainWindow() | Out-Null }; 'asked'`
    : `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class AdrianFrame { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n); [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string w); }'; $h=[AdrianFrame]::FindWindow($null, ${psLiteral(title)}); if ($h -eq [IntPtr]::Zero) { 'missing' } else { [AdrianFrame]::ShowWindow($h, ${show}) | Out-Null; 'asked' }`;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { timeout: 8000, windowsHide: true });
    return String(stdout || "").includes("missing") ? `Windows did not find ${title}. Nothing was changed.` : `Adrian asked Windows to ${action} ${title}.`;
  } catch {
    return "Windows did not change that window.";
  }
}

async function windowsAccessibility(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", "Add-Type -AssemblyName UIAutomationClient; $name=[System.Windows.Automation.AutomationElement]::RootElement.Current.Name; 'root=' + $name"], { timeout: 8000, windowsHide: true });
    const text = String(stdout || "").trim();
    return text.startsWith("root=") ? `Windows accessibility root: ${text.slice(5) || "unnamed"}. No button was clicked.` : "Windows accessibility did not answer. Nothing was clicked.";
  } catch {
    return "Windows accessibility did not answer. Nothing was clicked.";
  }
}

async function windowsFindButtons(name: string, windowTitle?: string): Promise<string[]> {
  const script = `Add-Type -AssemblyName UIAutomationClient; $root=[System.Windows.Automation.AutomationElement]::RootElement; ${windowTitle ? `$wins=@($root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.Name -eq ${psLiteral(windowTitle)} }); if ($wins.Count -ne 1) { exit }; $root=$wins[0];` : ""} $cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button); $all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond); $hits=@(); foreach ($b in $all) { if ($b.Current.Name -eq ${psLiteral(name)}) { $hits += $b.Current.Name } }; $hits -join "\`n"`;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { timeout: 15000, windowsHide: true });
    return String(stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    throw new Error("Windows button discovery failed; no result was established.");
  }
}

async function windowsInvokeButton(name: string, windowTitle: string): Promise<boolean> {
  const script = `Add-Type -AssemblyName UIAutomationClient; $root=[System.Windows.Automation.AutomationElement]::RootElement; ${windowTitle ? `$wins=@($root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.Name -eq ${psLiteral(windowTitle)} }); if ($wins.Count -ne 1) { exit }; $root=$wins[0];` : ""} $cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button); $all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond); $hits=@($all | Where-Object { $_.Current.Name -eq ${psLiteral(name)} }); if ($hits.Count -ne 1) { 'refused' } else { $hits[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); 'clicked' }`;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { timeout: 15000, windowsHide: true });
    return String(stdout || "").includes("clicked");
  } catch {
    return false;
  }
}

async function captureScreenPng(platform: NodeJS.Platform, signal?: AbortSignal): Promise<Buffer | null> {
  if (platform !== "win32") return null;
  const dir = await mkdtemp(path.join(os.tmpdir(), "adrian-screen-"));
  const shot = path.join(dir, "primary.png");
  const script = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bounds=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bitmap=New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height; $graphics=[System.Drawing.Graphics]::FromImage($bitmap); try { $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size); $bitmap.Save(${psLiteral(shot)}) } finally { $graphics.Dispose(); $bitmap.Dispose() }`;
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { timeout: 15000, windowsHide: true, signal });
    return signal?.aborted ? null : await readFile(shot);
  } catch { return null; }
  finally { await rm(dir, { recursive: true, force: true }).catch(() => undefined); }
}

async function launchApp(platform: NodeJS.Platform, name: string): Promise<string> {
  if (platform !== "win32") return "This computer is not Windows. The app was not launched.";
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", `Start-Process ${psLiteral(name)}`], { timeout: 8000, windowsHide: true });
    return `Adrian asked Windows to launch ${name}.`;
  } catch {
    return "Windows did not launch that app.";
  }
}

async function windowsCommand(platform: NodeJS.Platform, title: string | undefined): Promise<string> {
  if (platform !== "win32") return "This computer is not Windows. No window was listed or switched.";
  if (!title) {
    try {
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", "Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object -ExpandProperty MainWindowTitle"], { timeout: 8000, windowsHide: true });
      const names = String(stdout || "").trim();
      return names ? `Adrian listed windows: ${names.slice(0, 2000)}` : "Adrian found no titled windows.";
    } catch {
      return "Windows did not list windows.";
    }
  }
  try {
    const script = `$wshell = New-Object -ComObject WScript.Shell; if ($wshell.AppActivate(${psLiteral(title)})) { 'focused' } else { 'not-found' }`;
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { timeout: 8000, windowsHide: true });
    return String(stdout || "").includes("focused") ? `Adrian asked Windows to focus ${title}.` : `Windows did not find ${title}. Nothing was focused.`;
  } catch {
    return "Windows did not switch windows.";
  }
}

async function listOwnerFolder(root: string): Promise<string> {
  const safe = insideRoot(root, root);
  if (!safe) return "That folder is outside the owner desktop. Nothing was listed.";
  try {
    const names = await readdir(safe);
    const shown = names.slice(0, 40);
    return shown.length
      ? `Adrian listed ${shown.length} item(s) in ${safe}: ${shown.join(", ")}`
      : `Adrian opened ${safe}. It is empty.`;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return `Adrian looked for ${safe}. That folder is not on this computer.`;
    return "Adrian could not read that folder. Nothing else was opened.";
  }
}

async function safeOwnerPath(root: string, name: string): Promise<string | null> {
  const safe = insideRoot(root, path.resolve(root, name));
  if (!safe) return null;
  const rootStat = await lstat(root).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) return null;
  let current = path.resolve(root);
  for (const segment of path.relative(root, safe).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (info?.isSymbolicLink()) return null;
  }
  return safe;
}

export async function readOwnerFile(root: string, name: string): Promise<string> {
  const safe = await safeOwnerPath(root, name);
  if (!safe) return "That file is outside the owner folder. Nothing was read.";
  try {
    const info = await lstat(safe);
    if (!info.isFile()) return "That path is not a file. Nothing was read.";
    if (info.size > 200_000) return "That file is too large to read into the chat.";
    const text = await readFile(safe, "utf8");
    return `Adrian read ${safe}:\n${text.slice(0, 4000)}`;
  } catch {
    return "Adrian could not read that file. Nothing else was opened.";
  }
}

async function writeOwnerFile(root: string, name: string, content: string): Promise<string> {
  const safe = await safeOwnerPath(root, name);
  if (!safe) return "That file is outside the owner folder. Nothing was written.";
  await mkdir(path.dirname(safe), { recursive: true });
  await writeFile(safe, content, "utf8");
  return `Adrian wrote ${safe}.`;
}

async function makeOwnerFolder(root: string, name: string): Promise<string> {
  const safe = await safeOwnerPath(root, name);
  if (!safe) return "That folder is outside the owner folder. Nothing was created.";
  await mkdir(safe, { recursive: true });
  return `Adrian created ${safe}.`;
}

async function runOwnerCommand(root: string, platform: NodeJS.Platform, command: string): Promise<string> {
  const executable = platform === "win32" ? "powershell.exe" : "bash";
  const args = platform === "win32" ? ["-NoProfile", "-NonInteractive", "-Command", command] : ["-lc", command];
  try {
    const { stdout, stderr } = await execFileAsync(executable, args, { cwd: root, timeout: 20_000, windowsHide: true, maxBuffer: 200_000 });
    const text = `${stdout || ""}${stderr || ""}`.trim();
    return text ? `Adrian ran the command in ${root}:\n${text.slice(0, 4000)}` : `Adrian ran the command in ${root}. It returned no output.`;
  } catch {
    return "Adrian could not confirm that command completed. Its effects may be partial; inspect the device before retrying.";
  }
}

async function clickPointer(platform: NodeJS.Platform, x: number, y: number): Promise<string> {
  if (platform !== "win32") return "This computer is not Windows. Nothing was clicked.";
  const script = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class AdrianClick { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, System.UIntPtr e); }'; [AdrianClick]::SetCursorPos(${x}, ${y}); [AdrianClick]::mouse_event(2,0,0,0,[System.UIntPtr]::Zero); [AdrianClick]::mouse_event(4,0,0,0,[System.UIntPtr]::Zero)`;
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { timeout: 8000, windowsHide: true });
    return `Adrian clicked ${x},${y}.`;
  } catch {
    return "Windows did not click. Nothing was pressed.";
  }
}

async function movePointer(platform: NodeJS.Platform): Promise<string> {
  if (platform !== "win32") return "This computer is not Windows. The pointer was not moved.";
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(80,80)"], { timeout: 8000, windowsHide: true });
    return "Adrian moved the pointer to 80,80.";
  } catch {
    return "Windows did not move the pointer. Nothing was clicked.";
  }
}

async function inspectScreen(root: string, platform: NodeJS.Platform): Promise<string> {
  if (platform !== "win32") return "This computer is not Windows. The screen was not captured.";
  const shot = path.join(root, "adrian-screen.png");
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save(${psLiteral(shot)})
$graphics.Dispose(); $bitmap.Dispose()
Write-Output ("size=" + $bounds.Width + "x" + $bounds.Height)
`;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { timeout: 15000, windowsHide: true });
    return `Adrian captured the screen to ${shot}. ${String(stdout || "").trim()}`;
  } catch {
    return "Windows did not capture the screen. Nothing was clicked.";
  }
}

async function openBrowser(platform: NodeJS.Platform, url: string | undefined): Promise<string> {
  if (platform !== "win32") return "This computer is not Windows. The browser was not opened.";
  const target = url && /^https:\/\//.test(url) ? url : "https://www.bing.com";
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", `Start-Process ${psLiteral(target)}`], { timeout: 8000, windowsHide: true });
    return `Adrian opened the browser at ${target}.`;
  } catch {
    return "Windows did not open the browser. Nothing was clicked.";
  }
}

async function typeText(platform: NodeJS.Platform, text: string): Promise<string> {
  if (platform !== "win32") return "This computer is not Windows. Nothing was typed.";
  const safe = text.replace(/[+^%~(){}[\]]/g, "{$&}");
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${safe.replace(/'/g, "''")}')`], { timeout: 8000, windowsHide: true });
    return "Adrian typed the requested text.";
  } catch {
    return "Windows did not type the text.";
  }
}
