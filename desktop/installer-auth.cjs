const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);

async function verifyInstallerPublisher(file, expectedSignerSha256, options = {}) {
  if ((options.platform ?? process.platform) !== "win32") return { ok: false, reason: "Installer signature verification requires Windows. Nothing was installed." };
  if (!/^[a-f0-9]{64}$/.test(expectedSignerSha256) || typeof file !== "string" || /[\r\n\0]/.test(file)) return { ok: false, reason: "Installer identity is invalid." };
  const literal = `'${file.replaceAll("'", "''")}'`;
  const script = `$ErrorActionPreference='Stop'; $s=Get-AuthenticodeSignature -LiteralPath ${literal}; if ($s.Status -ne 'Valid' -or !$s.SignerCertificate) { @{valid=$false}|ConvertTo-Json -Compress; exit }; $h=[System.Security.Cryptography.SHA256]::Create(); $digest=([BitConverter]::ToString($h.ComputeHash($s.SignerCertificate.RawData))).Replace('-','').ToLowerInvariant(); @{valid=$true;signerSha256=$digest}|ConvertTo-Json -Compress`;
  try {
    const result = await (options.run ?? run)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 15_000, windowsHide: true, maxBuffer: 8000 });
    const identity = JSON.parse(result.stdout);
    return identity.valid === true && identity.signerSha256 === expectedSignerSha256 ? { ok: true, signerSha256: identity.signerSha256 } : { ok: false, reason: "The installer signature or publisher identity did not match the trusted release. Nothing was installed." };
  } catch { return { ok: false, reason: "Installer publisher verification failed. Nothing was installed." }; }
}
module.exports = { verifyInstallerPublisher };
