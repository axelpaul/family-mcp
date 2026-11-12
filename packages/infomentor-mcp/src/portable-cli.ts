#!/usr/bin/env bun
import { emitKeypressEvents } from 'node:readline';
import { InfoMentorError } from './session.js';

/** Terminal-only input: credentials never enter arguments, files or shell history. */
function prompt(label: string, secret: boolean): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw new InfoMentorError(
      'INVALID_CONFIGURATION',
      'Login needs an interactive terminal, or configured private credentials.',
    );

  return new Promise((resolve, reject) => {
    let value = '';
    const input = process.stdin;
    const wasRaw = input.isRaw;
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    process.stderr.write(label);

    const finish = (): void => {
      input.removeListener('keypress', onKey);
      input.removeListener('end', onEnd);
      input.setRawMode(wasRaw);
      input.pause();
      process.stderr.write('\n');
    };

    const onEnd = (): void => {
      finish();
      reject(new InfoMentorError('CANCELLED', 'Login cancelled.'));
    };

    const onKey = (
      text: string | undefined,
      key: { name?: string; ctrl?: boolean; meta?: boolean },
    ): void => {
      if ((key.ctrl && key.name === 'c') || (key.ctrl && key.name === 'd')) {
        onEnd();

        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        finish();
        resolve(value);

        return;
      }

      if (key.name === 'backspace') {
        if (value) {
          value = Array.from(value).slice(0, -1).join('');

          if (!secret) process.stderr.write('\b \b');
        }

        return;
      }

      if (
        !text ||
        key.ctrl ||
        key.meta ||
        Array.from(text).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      )
        return;

      if (value.length + text.length > 4096) return;
      value += text;

      if (!secret) process.stderr.write(text);
    };

    input.on('keypress', onKey);
    input.once('end', onEnd);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === 'config' && args.length === 1) {
    const source = process.argv[1]?.endsWith('portable-cli.ts') ? [process.argv[1]] : [];
    process.stdout.write(
      JSON.stringify(
        { mcpServers: { infomentor: { command: process.execPath, args: [...source, 'serve'] } } },
        null,
        2,
      ) + '\n',
    );

    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      'InfoMentor MCP\n\n  infomentor-mcp login    Sign in (hidden password prompt)\n  infomentor-mcp config   Print MCP client configuration\n  infomentor-mcp serve    Run MCP (default)\n  infomentor-mcp status   Check your session\n  infomentor-mcp logout   Remove your saved sign-in\n\nWindows, macOS and Linux standalone binaries. Advanced upstream options remain available.',
    );

    return;
  }

  const login = args[0] === 'login' || (args[0] === 'auth' && args[1] === 'login');

  const configured =
    args.some(
      (arg) =>
        arg === '--credentials' ||
        arg.startsWith('--credentials=') ||
        arg === '--import' ||
        arg.startsWith('--import='),
    ) ||
    process.env['INFOMENTOR_CREDENTIALS_FILE'] ||
    process.env['INFOMENTOR_USERNAME'] ||
    process.env['INFOMENTOR_PASSWORD'];

  if (login && !configured) {
    process.env['INFOMENTOR_USERNAME'] = await prompt('InfoMentor username or kennitala: ', false);
    process.env['INFOMENTOR_PASSWORD'] = await prompt('Password (hidden): ', true);
  }

  await import('./cli.js');
}

// The entrypoint is an I/O error boundary; only our fixed public errors are displayed.
// oxlint-disable-next-line anti-slop/no-unknown-parameters
void main().catch((error: unknown) => {
  process.stderr.write(
    (error instanceof InfoMentorError
      ? error.message
      : 'Cannot start InfoMentor. Check your terminal and private storage.') + '\n',
  );
  process.exitCode = 1;
});
