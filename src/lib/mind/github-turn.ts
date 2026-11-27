/** Parse only the user's current message. Repository contents never trigger another operation. */
export function githubAction(text: string) {
  const query = text.trim();
  if (/^(?:can you (?:access|see|check)|do you have access to|(?:please )?(?:open|check|show|list|go to)) (?:my |the )?github(?: account| profile| repos(?:itories)?)?[.!?]*$/i.test(query) || /^\/github(?: repos)?$/i.test(query)) return { kind: "repos" as const };
  const match = /^\/github (read|update) ([\w.-]+\/[\w.-]+) ([\w./-]+) ([\w./-]+)(?: ([a-f0-9]{40})\n([\s\S]+))?$/i.exec(text.trimStart());
  if (!match || [match[2],match[3],match[4]].some(value => value.split("/").some(part => !part || part === "." || part === ".."))) return null;
  const [, verb, repo, branch, path, sha, content] = match;
  if (verb.toLowerCase() === "read" && !sha) return { kind: "read" as const, repo, branch, path };
  if (verb.toLowerCase() === "update" && sha && content) return { kind: "update" as const, repo, branch, path, sha, content };
  return null;
}

export async function runGithubAction(action: NonNullable<ReturnType<typeof githubAction>>, token: string, signal: AbortSignal, request = fetch) {
  const listing = action.kind === "repos";
  const path = listing ? "/user/repos?per_page=30&sort=pushed" : "/repos/" + action.repo + "/contents/" + action.path.split("/").map(encodeURIComponent).join("/");
  const writing = action.kind === "update";
  const response = await request("https://api.github.com" + path + (action.kind === "read" ? "?ref=" + encodeURIComponent(action.branch) : ""), {
    method: writing ? "PUT" : "GET", redirect: "error", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
    headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json", "content-type": "application/json" },
    ...(writing ? { body: JSON.stringify({ message: "Update " + action.path + " from Adrian Build", branch: action.branch, sha: action.sha, content: Buffer.from(action.content).toString("base64") }) } : {}),
  });
  if (!response.ok) throw new Error(response.status === 401 ? "Reconnect GitHub in Connections." : "GitHub returned HTTP " + response.status + ". Check the repository, permissions and current file revision.");
  const result = await response.json();
  let text: string;
  if (listing && Array.isArray(result)) {
    text = "GitHub returned " + result.length + " accessible repositories on this page.\n" + result.map(row => row.full_name).join("\n");
  } else if (writing && /^[a-f0-9]{40}$/.test(result.commit?.sha)) {
    text = "GitHub committed " + action.path + " to " + action.repo + " on " + action.branch + ". Commit " + result.commit.sha;
  } else if (action.kind === "read" && result.type === "file" && result.encoding === "base64" && typeof result.content === "string" && result.size <= 24000) {
    text = action.repo + " · " + action.branch + " · " + action.path + "\nFile SHA " + result.sha + "\n\n" + new TextDecoder("utf-8", {fatal:true}).decode(Buffer.from(result.content, "base64"));
  } else throw new Error("GitHub did not return a supported text file or operation receipt.");
  return { text, requestId: response.headers.get("x-github-request-id") };
}
