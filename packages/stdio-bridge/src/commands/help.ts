/**
 * `maket help` — show usage. Also runs for unknown commands and `--help`.
 */

const HELP = `maket — visual design tool for AI assistants (MCP server)

USAGE
  maket [command] [options]

When invoked with no command and a non-TTY stdin, runs the stdio MCP bridge
(used by Claude Desktop, Codex, and other MCP clients).

COMMANDS
  bridge              Run stdio ↔ HTTP MCP proxy (default for MCP clients)
  start               Start the Maket HTTP server in the background
  stop                Stop a server started by 'maket start'
  status              Show whether the server is reachable
  open                Open the Maket UI in your browser
  logs [--bridge]     Tail server logs (or bridge log with --bridge)
  install <client>    Install Maket as an MCP server in a client
                        clients: claude | codex
                        flags:   --apply      write the config (default: print only)
                                 --scope=user|project   (claude only, default: user)
  gmail <sub>         Manage Gmail OAuth state on this machine
                        sub: status | reset [--force]
                        see docs/gmail-setup.md for the full setup walkthrough
  help, --help        Show this help
  version, --version  Show the installed Maket version

ENVIRONMENT
  MAKET_PORT          HTTP port (default 24842)
  MAKET_HOST          Bind host (default 127.0.0.1)
  MAKET_DATA_DIR      Server data dir (default ~/.maket)

EXAMPLES
  npx -y @ng-galien/maket install claude --apply
  npx -y @ng-galien/maket install codex --apply
  maket start && maket open
  maket status
  maket gmail status
  maket gmail reset --force
  maket stop
`;

export function runHelp(): void {
	process.stdout.write(HELP);
}
