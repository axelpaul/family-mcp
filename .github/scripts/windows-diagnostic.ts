// CI-only, synthetic paths and canned commands. Never used with real credentials.
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = process.env.SystemRoot!;
const exe = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const scratch = await mkdtemp(join(tmpdir(), 'acl-diagnostic-'));
const source = await readFile('packages/session-store/src/windows.ts', 'utf8');
const aclScript = source.split('const SCRIPT = String.raw`')[1]!.split('`;')[0]!.replace('} catch { exit 1 }', '} catch { [Console]::Error.Write($_.Exception.Message); exit 1 }');
const isolated = { SystemRoot: root, WINDIR: root, TEMP: process.env.TEMP, TMP: process.env.TMP };
try {
  for (const [name, script, env] of [
    ['canned-inherited', "[Console]::Out.Write('ok'); exit 0", process.env],
    ['canned-isolated', "[Console]::Out.Write('ok'); exit 0", isolated],
    ['acl-inherited', aclScript, process.env],
    ['acl-isolated', aclScript, isolated],
  ] as const) {
    const child = Bun.spawn([exe, '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      env: { ...env, FAMILY_MCP_ACL_REQUEST: JSON.stringify({ path: scratch, create: true }) },
      stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: 5000,
    });
    const result = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    console.log(name, JSON.stringify(result));
  }
} finally { await rm(scratch, { recursive: true, force: true }); }
