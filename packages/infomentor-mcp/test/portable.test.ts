import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';
import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  LocalKeyFileProvider,
  createSecretKey,
  ensurePrivateDir,
  readPrivateFile,
  withSecretStore,
  writePrivateFile,
} from '@family-mcp/session-store';

// Real native filesystem/ACL tests, not mocked platform flags. No real account or network.
test('portable encrypted store preserves secrets and coordinates concurrent updates', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'portable-infomentor-'));

  try {
    const options = {
      path: join(scratch, 'records', 'session.enc'),
      server: 'infomentor-mcp',
      profile: 'default',
      purpose: 'session',
      schema: 1,
      maxBytes: 4096,
      keys: new LocalKeyFileProvider({ path: join(scratch, 'keys', 'default.key') }),
    };

    await createSecretKey(options);
    await withSecretStore(options, async (store) => {
      await store.write('synthetic-password:0');
    });
    await Promise.all(
      Array.from({ length: 3 }, () =>
        withSecretStore(options, async (store) => {
          const previous = await store.read();
          const count = Number(previous?.split(':')[1]);
          await store.write(`synthetic-password:${count + 1}`);
        }),
      ),
    );
    expect(await withSecretStore(options, (store) => store.read())).toBe('synthetic-password:3');
    expect((await readFile(options.path, 'utf8')).includes('synthetic-password')).toBe(false);
    await withSecretStore(options, async (store) => {
      await store.write('logged-out');
    });
    expect(await withSecretStore(options, (store) => store.read())).toBe('logged-out');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 180_000);

test('private files round-trip and Windows rejects widened ACLs', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'portable-infomentor-Íslenska-'));

  try {
    const directory = join(scratch, 'private');
    await ensurePrivateDir(directory);
    const file = join(directory, 'credentials.json');
    await writePrivateFile(file, '{"synthetic":true}');
    expect(await readPrivateFile(file, { maxBytes: 100 })).toBe('{"synthetic":true}');

    if (process.platform === 'win32') {
      const child = Bun.spawn(['icacls.exe', file, '/grant', '*S-1-1-0:(R)'], {
        stdout: 'ignore',
        stderr: 'ignore',
      });

      expect(await child.exited).toBe(0);
      await assert.rejects(readPrivateFile(file, { maxBytes: 100 }));
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 120_000);

test('portable config prints a local stdio launch command; closed-stdin login refuses', async () => {
  const binary = process.env['INFOMENTOR_PORTABLE_BINARY'];

  const command = binary
    ? [resolve(binary)]
    : [process.execPath, resolve(import.meta.dir, '../src/portable-cli.ts')];

  const child = Bun.spawn([...command, 'config'], { stdout: 'pipe', stderr: 'pipe' });

  const config = z
    .object({
      mcpServers: z.object({
        infomentor: z.object({ command: z.string(), args: z.array(z.string()) }),
      }),
    })
    .parse(JSON.parse(await new Response(child.stdout).text()));

  expect(await child.exited).toBe(0);
  expect(config.mcpServers.infomentor.command).toBe(command[0] ?? '');
  expect(config.mcpServers.infomentor.args.at(-1)).toBe('serve');

  const login = Bun.spawn([...command, 'login'], {
    env: {
      ...process.env,
      INFOMENTOR_USERNAME: '',
      INFOMENTOR_PASSWORD: '',
      INFOMENTOR_CREDENTIALS_FILE: '',
    },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const error = await new Response(login.stderr).text();
  expect(await login.exited).toBe(1);
  expect(error).toContain('interactive terminal');
});

test('standalone MCP starts and exposes seven read tools without an account', async () => {
  const binary = process.env['INFOMENTOR_PORTABLE_BINARY'];

  if (!binary) return;
  const scratch = await mkdtemp(join(tmpdir(), 'portable-infomentor-mcp-'));
  const client = new Client({ name: 'portable-smoke', version: '1' });

  try {
    const transport = new StdioClientTransport({
      command: resolve(binary),
      args: ['serve'],
      stderr: 'pipe',
      env: {
        HOME: scratch,
        USERPROFILE: scratch,
        LOCALAPPDATA: scratch,
        XDG_CONFIG_HOME: join(scratch, 'config'),
        XDG_DATA_HOME: join(scratch, 'data'),
        FAMILY_MCP_STORE_TEST_SEAM: '1',
        SystemRoot: process.env['SystemRoot'] ?? '',
      },
    });

    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).toSorted()).toEqual([
      'infomentor_collect_updates',
      'infomentor_get_message',
      'infomentor_get_messages',
      'infomentor_get_notifications',
      'infomentor_get_overview',
      'infomentor_select_child',
      'infomentor_session_status',
    ]);
    const status = await client.callTool({ name: 'infomentor_session_status', arguments: {} });
    expect(
      z.object({ authenticated: z.boolean() }).parse(status.structuredContent).authenticated,
    ).toBe(false);
  } finally {
    await client.close();
    await rm(scratch, { recursive: true, force: true });
  }
}, 120_000);
