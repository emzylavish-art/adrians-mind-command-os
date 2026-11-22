import { execFile } from "node:child_process";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { consequentialSpeechRefusal } from "./frontier-2031.ts";
import { destructiveSpeechRefusal } from "./reversibility.ts";

const execFileAsync = promisify(execFile);

const FILE_INTENT = /\b(my files|my desktop|list (my )?(files|desktop)|open my (files|desktop)|go to my files)\b/i;
const MOUSE_INTENT = /\b(move the mouse|move my mouse|click|control my (pc|computer))\b/i;
const TYPE_INTENT = /\btype\s+"([^"]{1,200})"/i;
const READ_INTENT = /\bread file\s+([A-Za-z0-9._ /-]+)/i;
const WRITE_INTENT = /\bwrite file\s+([A-Za-z0-9._ /-]+):\s*([\s\S]{1,20000})/i;
const FOLDER_INTENT = /\bmake folder\s+([A-Za-z0-9._ -]+)/i;
const RUN_INTENT = /\brun command\s+([^\n]{1,400})/i;
const CLICK_INTENT = /\bclick\s+(\d{1,4})\s+(\d{1,4})\b/i;
const SCREEN_INTENT = /\b(look at my screen|what is on my screen|drive the screen|read my screen)\b/i;
const BROWSER_INTENT = /\bopen my browser(?:\s+(https?:\/\/\S+))?\b/i;
const APP_INTENT = /\blaunch app\s+([A-Za-z0-9 ._-]{1,80})/i;
const WINDOW_INTENT = /\b(list windows|switch window\s+([A-Za-z0-9 ._-]{1,80}))/i;
const RIGHT_CLICK = /\bright-click\s+(\d{1,4})\s+(\d{1,4})\b/i;
const DOUBLE_CLICK = /\bdouble-click\s+(\d{1,4})\s+(\d{1,4})\b/i;
const SCROLL = /\bscroll\s+(up|down)\b/i;
const DRAG = /\bdrag\s+(\d{1,4})\s+(\d{1,4})\s+to\s+(\d{1,4})\s+(\d{1,4})\b/i;
const WINDOW_ACTION = /\b(minimize|maximize|close) window\s+([A-Za-z0-9 ._-]{1,80})/i;
const MONITORS = /\blist monitors\b/i;
const A11Y = /\bread accessibility\b/i;
const FIND_BUTTON = /\bfind button\s+(.{1,80})/i;
const VISION = /\bunderstand (?:the )?screenshot\b/i;
const WORKER = /\bkeep working after close\b/i;

export function adrianPcEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ADRIAN_PC === "1";
}

function insideRoot(root: string, target: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) return null;
  return resolved;
}

export async function runAdrianPc(input: {
  text: string;
  halted: boolean;
  root?: string;
  platform?: NodeJS.Platform;
}): Promise<{ ran: boolean; output: string }> {
  const text = input.text.trim();
  if (!text) return { ran: false, output: "" };
  if (input.halted) return { ran: true, output: "Emergency stop is on. Nothing ran." };
  const refused = consequentialSpeechRefusal(text);
  if (refused) return { ran: true, output: refused };
  const destructive = destructiveSpeechRefusal(text);
  if (destructive) return { ran: true, output: destructive };
  const wantsFiles = FILE_INTENT.test(text);
  const wantsMouse = MOUSE_INTENT.test(text) && !CLICK_INTENT.test(text);
  const typed = text.match(TYPE_INTENT);
  const readName = text.match(READ_INTENT);
  const writeMatch = text.match(WRITE_INTENT);
  const folder = text.match(FOLDER_INTENT);
  const command = text.match(RUN_INTENT);
  const click = text.match(CLICK_INTENT);
  const wantsScreen = SCREEN_INTENT.test(text);
  const browser = text.match(BROWSER_INTENT);
  const app = text.match(APP_INTENT);
  const windows = text.match(WINDOW_INTENT);
  const extra = RIGHT_CLICK.test(text) || DOUBLE_CLICK.test(text) || SCROLL.test(text) || DRAG.test(text) || WINDOW_ACTION.test(text) || MONITORS.test(text) || A11Y.test(text) || FIND_BUTTON.test(text) || VISION.test(text) || WORKER.test(text);
  if (!wantsFiles && !wantsMouse && !typed && !readName && !writeMatch && !folder && !command && !click && !wantsScreen && !browser && !app && !windows && !extra) return { ran: false, output: "" };

  const root = path.resolve(input.root || path.join(os.homedir(), "Desktop"));
  const platform = input.platform || process.platform;
  const lines: string[] = [];

  if (wantsFiles) {
    const listed = await listOwnerFolder(root);
    lines.push(listed);
  }
  if (wantsMouse) {
    lines.push(await movePointer(platform));
  }
  if (typed) {
    lines.push(await typeText(platform, typed[1]));
  }
  if (readName) lines.push(await readOwnerFile(root, readName[1].trim()));
  if (writeMatch) lines.push(await writeOwnerFile(root, writeMatch[1].trim(), writeMatch[2]));
  if (folder) lines.push(await makeOwnerFolder(root, folder[1].trim()));
  if (command) lines.push(await runOwnerCommand(root, platform, command[1].trim()));
  if (click) lines.push(await clickPointer(platform, Number(click[1]), Number(click[2])));
  if (wantsScreen) lines.push(await inspectScreen(root, platform));
  if (browser) lines.push(await openBrowser(platform, browser[1]));
  if (app) lines.push(await launchApp(platform, app[1].trim()));
  if (windows) lines.push(await windowsCommand(platform, windows[2]));
  if (extra) lines.push(await extraPc(text, platform));
  return { ran: true, output: lines.join("\n") };
}

async function extraPc(text: string, platform: NodeJS.Platform): Promise<string> {
  if (WORKER.test(text)) return "No worker stays up after the app closes. Nothing was started.";
  if (VISION.test(text)) return "The screenshot was not understood. No vision model read it.";
  if (FIND_BUTTON.test(text)) return "No accessibility tree answered. The button was not clicked.";
  if (platform !== "win32") return "This computer is not Windows. Nothing was clicked, dragged, closed, or captured.";
  if (A11Y.test(text)) return windowsAccessibility();
  if (MONITORS.test(text)) {
    try {
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $_.DeviceName }"], { timeout: 8000, windowsHide: true });
      return String(stdout || "").trim() || "Windows returned no monitors.";
    } catch {
      return "Windows did not list monitors.";
    }
  }
  const action = text.match(WINDOW_ACTION);
  if (action) return windowsFrame(action[1].toLowerCase(), action[2].trim());
  const right = text.match(RIGHT_CLICK);
  if (right) return windowsButton(Number(right[1]), Number(right[2]), "right");
  const double = text.match(DOUBLE_CLICK);
  if (double) return windowsButton(Number(double[1]), Number(double[2]), "double");
  const scroll = text.match(SCROLL);
  if (scroll) return windowsScroll(scroll[1].toLowerCase() === "up" ? 120 : -120);
  const drag = text.match(DRAG);
  if (drag) return windowsDrag(Number(drag[1]), Number(drag[2]), Number(drag[3]), Number(drag[4]));
  return "That pointer action was not recognized. Nothing moved.";
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
    ? `Get-Process | Where-Object { $_.MainWindowTitle -eq ${JSON.stringify(title)} } | ForEach-Object { $_.CloseMainWindow() | Out-Null }; 'asked'`
    : `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class AdrianFrame { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n); [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string w); }'; $h=[AdrianFrame]::FindWindow($null, ${JSON.stringify(title)}); if ($h -eq [IntPtr]::Zero) { 'missing' } else { [AdrianFrame]::ShowWindow($h, ${show}) | Out-Null; 'asked' }`;
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

async function launchApp(platform: NodeJS.Platform, name: string): Promise<string> {
  if (platform !== "win32") return "This computer is not Windows. The app was not launched.";
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", `Start-Process ${JSON.stringify(name)}`], { timeout: 8000, windowsHide: true });
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
    const script = `$wshell = New-Object -ComObject WScript.Shell; if ($wshell.AppActivate(${JSON.stringify(title)})) { 'focused' } else { 'not-found' }`;
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

export async function readOwnerFile(root: string, name: string): Promise<string> {
  const safe = insideRoot(root, path.join(root, name));
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
  const safe = insideRoot(root, path.join(root, name));
  if (!safe) return "That file is outside the owner folder. Nothing was written.";
  await mkdir(path.dirname(safe), { recursive: true });
  await writeFile(safe, content, "utf8");
  return `Adrian wrote ${safe}.`;
}

async function makeOwnerFolder(root: string, name: string): Promise<string> {
  const safe = insideRoot(root, path.join(root, name));
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
    return "Adrian could not finish that command. Nothing else was changed.";
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
$bitmap.Save(${JSON.stringify(shot)})
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
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", `Start-Process ${JSON.stringify(target)}`], { timeout: 8000, windowsHide: true });
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
