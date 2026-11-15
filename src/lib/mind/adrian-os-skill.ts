export const ADRIAN_OS_BUILDER_ORDER =
  "Follow the installed Adrian OS builder skill: continue the local product, prove changes on the preview, keep hosted files in the account store, use the IDE debugger and completions, do not print secrets, do not deploy, and do not claim complete.";

export const ADRIAN_OS_BUILDER_OUTPUT = [
  ADRIAN_OS_BUILDER_ORDER,
  "Preview is http://127.0.0.1:8080. Repo is /home/ubuntu/adrians-mind-command-os.",
  "Hosted files live in .data/adrian-build-workspace and are copied into the account table mind_kimi_file. A restart must restore them from that table, not from /tmp.",
  "Build runs the cloned Kimi process with login stripped and the saved Grok key. The coding model is grok-4.7. Human Code discusses. File writes go through Build.",
  "The IDE stays a file tree, tabs, and CodeMirror. Complete uses the project TypeScript language service. Debug pauses a hosted file in Node's inspector.",
  "Speak Place call is the in-app call. Do not claim a carrier handset call unless one was actually placed.",
  "The owner flow lists only file read, file write, file delete, and terminal. Run stays disabled until the approval string matches that exact action. The emergency stop blocks them. They run in the hosted workspace. Recording cannot continue after the tab closes. Do not build Windows software unless the owner says to.",
  "Question blueprint: /home/ubuntu/upload/Pasted_content_92.txt. Work unfinished questions by priority. Do not open Vercel. Slack stays off.",
].join("\n");
