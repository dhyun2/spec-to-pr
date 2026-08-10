import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEVELOPER_ACCESS_LEVEL = 30;

export type GitLabRemote = {
  host: string;
  projectPath: string;
  remoteName: string;
};

export type PreflightCheck = {
  id: "remote" | "glab" | "authentication" | "project" | "permission" | "merge-requests";
  status: "passed" | "warning" | "blocked";
  message: string;
};

export type GitLabMrPreflightResult = {
  kind: "spec-to-pr.gitlab-mr-preflight.v1";
  status: "ready-to-attempt" | "blocked" | "not-applicable";
  canCreateDraftMr: "not-guaranteed" | "no" | "not-applicable";
  remote?: GitLabRemote;
  checks: PreflightCheck[];
  limitations: string[];
  nextSteps: string[];
};

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  file: string,
  args: readonly string[],
  projectRoot: string,
) => Promise<CommandResult>;

export type GitLabMrPreflightInput = {
  projectRoot: string;
  remoteName?: string;
};

/**
 * Read-only GitLab readiness check. GitLab has no Draft MR creation dry-run,
 * so a passing result means "safe to attempt" rather than a false guarantee.
 */
export async function checkGitLabMrPreflight(
  input: GitLabMrPreflightInput,
  run: CommandRunner = runCommand,
): Promise<GitLabMrPreflightResult> {
  const remoteName = input.remoteName ?? "origin";
  const checks: PreflightCheck[] = [];
  const remoteCommand = await run(
    "git",
    ["-C", input.projectRoot, "remote", "get-url", remoteName],
    input.projectRoot,
  );
  const parsedRemote = parseGitLabRemote(remoteCommand.stdout.trim(), remoteName);

  if (remoteCommand.exitCode !== 0 || parsedRemote === undefined) {
    checks.push({
      id: "remote",
      status: "blocked",
      message: `Git remote \`${remoteName}\`에서 GitLab 프로젝트 경로를 읽지 못했습니다.`,
    });
    return blocked(checks);
  }
  checks.push({
    id: "remote",
    status: "passed",
    message: `remote \`${remoteName}\` → ${parsedRemote.host}/${parsedRemote.projectPath}`,
  });
  if (isKnownNonGitLabHost(parsedRemote.host)) return notApplicable(checks, parsedRemote);

  const glabCommand = await run("glab", ["--version"], input.projectRoot);
  if (glabCommand.exitCode !== 0) {
    checks.push({
      id: "glab",
      status: "blocked",
      message: "glab CLI를 실행할 수 없습니다.",
    });
    return blocked(checks, parsedRemote);
  }
  checks.push({ id: "glab", status: "passed", message: "glab CLI를 확인했습니다." });

  const authCommand = await run(
    "glab",
    ["auth", "status", "--hostname", parsedRemote.host],
    input.projectRoot,
  );
  if (authCommand.exitCode !== 0) {
    checks.push({
      id: "authentication",
      status: "blocked",
      message: `${parsedRemote.host}에 대한 glab 인증을 확인하지 못했습니다.`,
    });
    return blocked(checks, parsedRemote);
  }
  checks.push({
    id: "authentication",
    status: "passed",
    message: `${parsedRemote.host}의 glab 인증을 확인했습니다.`,
  });

  const encodedProject = encodeURIComponent(parsedRemote.projectPath);
  const projectCommand = await run(
    "glab",
    ["api", "--hostname", parsedRemote.host, "--method", "GET", `projects/${encodedProject}`],
    input.projectRoot,
  );
  const project = parseJson(projectCommand.stdout);
  if (projectCommand.exitCode !== 0 || project === undefined) {
    checks.push({
      id: "project",
      status: "blocked",
      message: "인증된 GitLab API로 프로젝트를 읽지 못했습니다.",
    });
    return blocked(checks, parsedRemote);
  }
  if (mergeRequestsAreDisabled(project)) {
    checks.push({
      id: "project",
      status: "blocked",
      message: "이 프로젝트는 Merge Request 기능이 비활성화되어 있습니다.",
    });
    return blocked(checks, parsedRemote);
  }
  checks.push({ id: "project", status: "passed", message: "프로젝트와 MR 기능을 읽었습니다." });

  const accessLevel = projectAccessLevel(project);
  if (accessLevel !== undefined && accessLevel < DEVELOPER_ACCESS_LEVEL) {
    checks.push({
      id: "permission",
      status: "blocked",
      message: `프로젝트 권한이 ${accessLevel}입니다. Draft MR에는 Developer(30) 이상이 필요합니다.`,
    });
    return blocked(checks, parsedRemote);
  }
  checks.push(
    accessLevel === undefined
      ? {
          id: "permission",
          status: "warning",
          message:
            "GitLab이 상세 역할 값을 보내지 않았습니다. 다음 API 읽기 결과로 계속 확인합니다.",
        }
      : {
          id: "permission",
          status: "passed",
          message: `프로젝트 권한 ${accessLevel}(Developer 이상)을 확인했습니다.`,
        },
  );

  const mergeRequestsCommand = await run(
    "glab",
    [
      "api",
      "--hostname",
      parsedRemote.host,
      "--method",
      "GET",
      `projects/${encodedProject}/merge_requests?state=opened&per_page=1`,
    ],
    input.projectRoot,
  );
  if (mergeRequestsCommand.exitCode !== 0 || !containsJson(mergeRequestsCommand.stdout)) {
    checks.push({
      id: "merge-requests",
      status: "blocked",
      message: "인증된 API로 프로젝트의 Merge Request 목록을 읽지 못했습니다.",
    });
    return blocked(checks, parsedRemote);
  }
  checks.push({
    id: "merge-requests",
    status: "passed",
    message: "Merge Request API 읽기 접근을 확인했습니다.",
  });

  return {
    kind: "spec-to-pr.gitlab-mr-preflight.v1",
    status: "ready-to-attempt",
    canCreateDraftMr: "not-guaranteed",
    remote: parsedRemote,
    checks,
    limitations: [
      "이 진단은 remote, 인증, 프로젝트와 Merge Request API의 GET 요청만 사용합니다.",
      "GitLab은 Draft MR 생성의 dry-run을 제공하지 않습니다. 실제 `glab mr create --draft` 성공만 최종 확인입니다.",
      "소스 브랜치 push 권한과 보호 브랜치 정책은 실제 브랜치·대상 브랜치에 따라 달라질 수 있습니다.",
    ],
    nextSteps: [],
  };
}

export function parseGitLabRemote(
  remoteUrl: string,
  remoteName = "origin",
): GitLabRemote | undefined {
  const projectPath = projectPathFromRemote(remoteUrl);
  if (projectPath === undefined) return undefined;

  return { remoteName, ...projectPath };
}

function projectPathFromRemote(remoteUrl: string): Omit<GitLabRemote, "remoteName"> | undefined {
  try {
    const url = new URL(remoteUrl);
    if (!["https:", "http:", "ssh:"].includes(url.protocol)) return undefined;
    const projectPath = normalizeProjectPath(url.pathname);
    if (projectPath === undefined) return undefined;
    return { host: url.hostname, projectPath };
  } catch {
    const match = /^(?:[^@\s/:]+@)?(?<host>[^\s/:]+):(?<path>.+)$/u.exec(remoteUrl);
    const host = match?.groups?.host;
    const projectPath = normalizeProjectPath(match?.groups?.path ?? "");
    if (host === undefined || projectPath === undefined) return undefined;
    return { host, projectPath };
  }
}

function normalizeProjectPath(value: string): string | undefined {
  const projectPath = value.replace(/^\/+|\/+$/gu, "").replace(/\.git$/u, "");
  return projectPath.includes("/") ? projectPath : undefined;
}

function isKnownNonGitLabHost(host: string): boolean {
  return host === "github.com" || host === "ssh.github.com" || host.endsWith(".github.com");
}

function mergeRequestsAreDisabled(project: Record<string, unknown>): boolean {
  return (
    project.merge_requests_enabled === false || project.merge_requests_access_level === "disabled"
  );
}

function projectAccessLevel(project: Record<string, unknown>): number | undefined {
  const permissions = project.permissions;
  if (!isRecord(permissions)) return undefined;

  const accessLevels = [permissions.project_access, permissions.group_access]
    .map(accessLevel)
    .filter((value): value is number => value !== undefined);
  return accessLevels.length === 0 ? undefined : Math.max(...accessLevels);
}

function accessLevel(value: unknown): number | undefined {
  if (!isRecord(value) || typeof value.access_level !== "number") return undefined;
  return value.access_level;
}

function parseJson(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function containsJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function blocked(checks: PreflightCheck[], remote?: GitLabRemote): GitLabMrPreflightResult {
  const host = remote?.host ?? "<GitLab 호스트>";
  return {
    kind: "spec-to-pr.gitlab-mr-preflight.v1",
    status: "blocked",
    canCreateDraftMr: "no",
    ...(remote === undefined ? {} : { remote }),
    checks,
    limitations: [
      "이 사전 진단은 읽기 전용입니다. 차단 상태에서는 코드 변경이나 MR 생성을 시작하지 않습니다.",
      "진단이 통과해도 GitLab에는 Draft MR 생성 dry-run이 없으므로 실제 생성이 최종 확인입니다.",
    ],
    nextSteps: [
      `1. GitLab remote와 프로젝트 경로를 확인합니다: git remote get-url ${remote?.remoteName ?? "origin"}`,
      `2. glab를 설치한 뒤 인증합니다: glab auth login --hostname ${host}`,
      "3. 개인 액세스 토큰을 쓴다면 API 요청용 `api` scope를 부여합니다. HTTPS로 브랜치를 push한다면 `write_repository`도 부여합니다.",
      "4. 프로젝트 멤버 권한을 Developer 이상으로 요청하고, 소스 브랜치 push 및 대상 보호 브랜치의 MR 정책을 확인합니다.",
      "5. 다시 사전 진단을 실행한 뒤, 실제 Draft MR 생성 결과를 확인합니다.",
    ],
  };
}

function notApplicable(checks: PreflightCheck[], remote: GitLabRemote): GitLabMrPreflightResult {
  return {
    kind: "spec-to-pr.gitlab-mr-preflight.v1",
    status: "not-applicable",
    canCreateDraftMr: "not-applicable",
    remote,
    checks,
    limitations: ["GitHub remote에는 GitLab/glab 사전 진단을 적용하지 않습니다."],
    nextSteps: ["GitHub remote라면 호스트의 GitHub 도구 또는 gh로 Draft PR 권한을 확인합니다."],
  };
}

async function runCommand(
  file: string,
  args: readonly string[],
  projectRoot: string,
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(file, [...args], {
      cwd: projectRoot,
      env: { ...process.env, GLAB_NO_PROMPT: "1" },
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const result = error as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    return {
      exitCode: typeof result.code === "number" ? result.code : 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }
}

function parseArgs(argv: readonly string[]): GitLabMrPreflightInput {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined || !flag.startsWith("--")) {
      throw new Error("Usage: check-gitlab-mr --project-root <absolute-path> [--remote <name>]");
    }
    values.set(flag, value);
  }

  const projectRoot = values.get("--project-root");
  if (projectRoot === undefined) {
    throw new Error("Usage: check-gitlab-mr --project-root <absolute-path> [--remote <name>]");
  }
  const remoteName = values.get("--remote");
  return { projectRoot, ...(remoteName === undefined ? {} : { remoteName }) };
}

if (/check-gitlab-mr\.(?:[cm]?js|ts)$/u.test(process.argv[1] ?? "")) {
  void runCli();
}

async function runCli(): Promise<void> {
  try {
    const result = await checkGitLabMrPreflight(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === "blocked") process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
