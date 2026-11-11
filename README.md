# InfoMentor MCP — portable fork

A simpler, local InfoMentor MCP for **Windows, macOS and Linux**. Forked from
[Ólafur Nils Sigurðsson's family-mcp](https://github.com/olafurns7/family-mcp), MIT licensed.
The upstream InfoMentor HTTP client and read-only MCP tools are retained.

**Status:** development preview. Native Windows/macOS verification is tracked by the
[Portable InfoMentor workflow](https://github.com/axelpaul/family-mcp/actions/workflows/portable-infomentor.yml).
A cross-compiled executable alone is not proof of working Windows support.

## Three commands

Download the executable for your operating system from the workflow's artifacts,
extract it and put it in a folder you keep. No Rust, Node, Bun, WSL or administrator
access is required to run the standalone executable. Preview binaries are not signed;
your operating system may warn about them.

Run in a terminal (PowerShell on Windows):

```powershell
.\infomentor-mcp.exe login
.\infomentor-mcp.exe config
```

On macOS/Linux:

```sh
chmod +x ./infomentor-mcp
./infomentor-mcp login
./infomentor-mcp config
```

Login asks for your InfoMentor username/kennitala and a **hidden password**. No JSON
credentials file, shell environment setup or password in command history is needed.
Paste the JSON printed by `config` into your MCP client's configuration, then restart
that client. It launches this same executable with `serve`. Keep the executable at
that location; rerun `config` if you move it.

Use `status` to check your session and `logout` to clear the local saved sign-in.
The default command is `serve`. Credentials stay on your machine; session renewal
uses the stored sign-in. A school that requires unsupported SSO/MFA may not work.

## What changed

- Reuse upstream's TypeScript implementation, compiled with Bun into a standalone
  executable; no Unix-only Rust storage dependency in these portable builds.
- Terminal login and generated MCP config, rather than a manual credentials file.
- Windows stores under `%LOCALAPPDATA%\family-mcp`. New store folders receive
  private Windows ACLs; existing shared folders/files are refused, not silently
  accepted. Windows PowerShell 5.1 (included with Windows) verifies those ACLs.
- Preserve upstream encryption, separate key file, session renewal, request origin
  checks and cross-process locks. This is **not** a plaintext-session shortcut.
- Existing Unix storage and advanced upstream flags remain compatible. Windows
  requires a local filesystem supporting Windows ACLs (normally NTFS), not FAT,
  a network share or a symlink/junction path.

Encryption protects a copied record without its key. Software running as your user,
administrators, or a backup containing both can still access the sign-in; this fork
does not claim otherwise. No live account tests are performed in CI.

The optional upstream WARP/direct-route scripts are **not required for normal setup**
and are not part of the portable workflow.

## Development

Use Bun **1.4.2**:

```sh
bun install --frozen-lockfile
bunx tsc --noEmit -p packages/infomentor-mcp/tsconfig.json
bun test packages/infomentor-mcp/test/portable.test.ts
bun build --compile packages/infomentor-mcp/src/portable-cli.ts --outfile infomentor-mcp
```

See [the original overview](UPSTREAM-README.md) and
[advanced InfoMentor documentation](packages/infomentor-mcp/README.md) for inherited
features. Other upstream packages remain in the fork but are not changed into
portable products by this work.
