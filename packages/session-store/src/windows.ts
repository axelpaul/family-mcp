import { dirname, join, resolve as absolutePath } from 'node:path';
import { lstat } from 'node:fs/promises';
import { SessionStoreError } from './errors.js';

// Fixed script; non-secret path/options arrive as JSON in a dedicated environment value.
// Paths are never interpolated into PowerShell code; no child stdin pipe is needed.
// Keep user, SYSTEM and Administrators access; reject every other allow entry. Windows
// administrators, like Unix root, are outside the store's threat model.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $request = $env:FAMILY_MCP_ACL_REQUEST | ConvertFrom-Json
  $path = [string]$request.path
  $item = Get-Item -LiteralPath $path -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'link' }
  $self = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($request.create) {
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($self)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($self.Value, 'S-1-5-18', 'S-1-5-32-544')) {
      $identity = New-Object Security.Principal.SecurityIdentifier($sid)
      $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
      $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $path -AclObject $acl
  }
  $acl = Get-Acl -LiteralPath $path
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($owner -notin @($self.Value, 'S-1-5-18', 'S-1-5-32-544')) { throw 'owner' }
  $raw = New-Object Security.AccessControl.RawSecurityDescriptor($acl.Sddl)
  if ($null -eq $raw.DiscretionaryAcl) { throw 'null-dacl' }
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -ne 'Allow') { continue }
    if ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) { continue }
    if ($rule.IdentityReference.Value -notin @($self.Value, 'S-1-5-18', 'S-1-5-32-544')) { throw 'sharing' }
  }
  [Console]::Out.Write('ok')
  exit 0
} catch { exit 1 }
`;

/** Check Windows ACLs, or secure a newly-created empty directory before writing any secret. */
export async function windowsPrivatePath(path: string, create = false): Promise<void> {
  if (process.platform !== 'win32') return;

  for (let current = absolutePath(path); ; current = dirname(current)) {
    if ((await lstat(current)).isSymbolicLink())
      throw new SessionStoreError(
        'UNSAFE_FILE',
        'Windows store paths must not contain links or junctions.',
      );

    if (dirname(current) === current) break;
  }

  const root = process.env['SystemRoot'];

  if (!root) throw new SessionStoreError('UNSAFE_FILE', 'Windows system directory is unavailable.');

  try {
    const child = Bun.spawn({
      cmd: [
        join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(SCRIPT, 'utf16le').toString('base64'),
      ],
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
      env: {
        SystemRoot: root,
        WINDIR: root,
        TEMP: process.env['TEMP'],
        TMP: process.env['TMP'],
        FAMILY_MCP_ACL_REQUEST: JSON.stringify({ path, create }),
      },
      timeout: 20_000,
    });

    const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);

    if (code !== 0 || output !== 'ok') throw new Error('ACL helper refused');
  } catch {
    throw new SessionStoreError(
      'UNSAFE_FILE',
      'Cannot verify private Windows permissions. Use a local NTFS folder owned by your Windows account, without sharing it with other users.',
    );
  }
}
