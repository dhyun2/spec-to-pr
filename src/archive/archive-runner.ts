import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ArchiveCommandRunner = (
  cwd: string,
  command: string,
  args: string[],
) => Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}>;

export async function runOpenSpecArchiveCommand(input: {
  projectRoot: string;
  changeName: string;
  commandRunner?: ArchiveCommandRunner;
}): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const command = "openspec";
  const args = ["archive", input.changeName, "--yes"];

  return (input.commandRunner ?? defaultArchiveCommandRunner)(input.projectRoot, command, args);
}

async function defaultArchiveCommandRunner(
  cwd: string,
  command: string,
  args: string[],
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const execution = await execFileAsync(command, args, {
    cwd,
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
  });

  return {
    stdout: execution.stdout,
    stderr: execution.stderr,
    exitCode: 0,
  };
}
