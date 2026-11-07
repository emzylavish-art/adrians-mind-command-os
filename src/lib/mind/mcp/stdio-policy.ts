/**
 * Stdio child env policy. Kept out of stdio.ts so registry code can apply it
 * without loading the MCP SDK client.
 */
const BLOCKED_CHILD_ENV = /^(LD_|DYLD_|NODE_OPTIONS$|NODE_PATH$|NODE_REPL_EXTERNAL_MODULE$|PYTHONSTARTUP$|PYTHONPATH$|PYTHONHOME$|PERL5OPT$|PERL5LIB$|RUBYOPT$|RUBYLIB$|BASH_ENV$|ENV$|PROMPT_COMMAND$|GIT_SSH_COMMAND$|GIT_EXEC_PATH$|PATH$|HOME$|MIND_MCP_STDIO_ALLOW$)/;

/** True for env keys a server config may NOT set on its child. */
export function isBlockedChildEnvKey(key: string): boolean {
  return BLOCKED_CHILD_ENV.test(key.toUpperCase());
}
