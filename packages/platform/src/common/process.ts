import { execFile } from "node:child_process";

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function runCommand(
  command: string,
  args: string[] = [],
  options: { timeoutMs?: number } = {}
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutMs = options.timeoutMs ?? 2500;
    const child = execFile(
      command,
      args,
      {
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        const maybeCode = error ? (error as { code?: unknown }).code : undefined;
        if (typeof maybeCode === "number") {
          resolve({
            code: maybeCode,
            stdout,
            stderr
          });
          return;
        }

        resolve({
          code: error ? 1 : 0,
          stdout,
          stderr
        });
      }
    );

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 1000);
      resolve({
        code: 1,
        stdout: "",
        stderr: `Command timed out after ${timeoutMs}ms.`
      });
    }, timeoutMs);
  });
}
