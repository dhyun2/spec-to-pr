import { mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { RunIdSchema, type RunId } from "../runtime/ids.js";
import { RevisionConflictError, RunAlreadyExistsError, RunNotFoundError } from "./errors.js";
import type { ListRunsFilter, RunStore } from "./run-store.js";
import type { RunManifest, RunSummary } from "../run/index.js";

type SqliteRunResult = {
  changes: number;
  lastInsertRowid?: number | bigint;
};

type SqliteStatement = {
  run: (...parameters: unknown[]) => SqliteRunResult;
  get: (...parameters: unknown[]) => unknown;
  all: (...parameters: unknown[]) => unknown[];
};

type SqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
};

type SqliteModule = {
  DatabaseSync: new (location: string) => SqliteDatabase;
};

const require = createRequire(import.meta.url);

function loadSqliteModule(): SqliteModule {
  return require("node:sqlite") as SqliteModule;
}

export class SqliteRunStore implements RunStore {
  private readonly database: SqliteDatabase;

  public constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), {
      recursive: true,
      mode: 0o700,
    });

    const { DatabaseSync } = loadSqliteModule();
    this.database = new DatabaseSync(databasePath);

    this.configure();
    this.migrate();
  }

  public async create(run: RunManifest): Promise<void> {
    const parsed = RunManifestSchema.parse(run);
    const summary = summarizeRun(parsed);

    try {
      this.transaction(() => {
        this.database
          .prepare(
            `
            INSERT INTO runs (
              id,
              schema_version,
              plugin_version,
              project_root,
              base_commit,
              status,
              revision,
              created_at,
              updated_at,
              manifest_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          )
          .run(
            parsed.id,
            parsed.schemaVersion,
            parsed.pluginVersion,
            parsed.projectRoot,
            parsed.baseCommit ?? null,
            parsed.status,
            parsed.revision,
            parsed.createdAt,
            parsed.updatedAt,
            serializeRun(parsed),
          );

        this.upsertSummary(summary);
      });
    } catch (error: unknown) {
      if (isSqliteConstraintError(error)) {
        throw new RunAlreadyExistsError(parsed.id);
      }

      throw error;
    }
  }

  public async get(rawRunId: RunId): Promise<RunManifest> {
    const runId = RunIdSchema.parse(rawRunId);

    const row = this.database.prepare("SELECT manifest_json FROM runs WHERE id = ?").get(runId);

    if (row === undefined) {
      throw new RunNotFoundError(runId);
    }

    const manifestJson = getStringColumn(row, "manifest_json");

    return RunManifestSchema.parse(JSON.parse(manifestJson));
  }

  public async save(run: RunManifest, expectedRevision: number): Promise<void> {
    const parsed = RunManifestSchema.parse(run);

    if (parsed.revision !== expectedRevision + 1) {
      throw new RevisionConflictError(parsed.id, expectedRevision + 1, parsed.revision);
    }

    const summary = summarizeRun(parsed);

    this.transaction(() => {
      const result = this.database
        .prepare(
          `
          UPDATE runs
          SET
            schema_version = ?,
            plugin_version = ?,
            project_root = ?,
            base_commit = ?,
            status = ?,
            revision = ?,
            created_at = ?,
            updated_at = ?,
            manifest_json = ?
          WHERE id = ? AND revision = ?
        `,
        )
        .run(
          parsed.schemaVersion,
          parsed.pluginVersion,
          parsed.projectRoot,
          parsed.baseCommit ?? null,
          parsed.status,
          parsed.revision,
          parsed.createdAt,
          parsed.updatedAt,
          serializeRun(parsed),
          parsed.id,
          expectedRevision,
        );

      if (result.changes !== 1) {
        const actualRevision = this.currentRevision(parsed.id);
        throw new RevisionConflictError(parsed.id, expectedRevision, actualRevision);
      }

      this.upsertSummary(summary);
    });
  }

  public async list(filter: ListRunsFilter = {}): Promise<RunSummary[]> {
    const limit = filter.limit ?? 50;

    if (limit <= 0 || limit > 500) {
      throw new Error("Run list limit must be between 1 and 500");
    }

    const rows =
      filter.status === undefined
        ? this.database
            .prepare(
              `
              SELECT summary_json
              FROM run_summaries
              ORDER BY updated_at DESC
              LIMIT ?
            `,
            )
            .all(limit)
        : this.database
            .prepare(
              `
              SELECT summary_json
              FROM run_summaries
              WHERE status = ?
              ORDER BY updated_at DESC
              LIMIT ?
            `,
            )
            .all(filter.status, limit);

    return rows.map((row) =>
      RunSummarySchema.parse(JSON.parse(getStringColumn(row, "summary_json"))),
    );
  }

  public async close(): Promise<void> {
    this.database.close();
  }

  private configure(): void {
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA busy_timeout = 5000");
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        schema_version TEXT NOT NULL,
        plugin_version TEXT NOT NULL,
        project_root TEXT NOT NULL,
        base_commit TEXT,
        status TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        CHECK (revision >= 0)
      );

      CREATE TABLE IF NOT EXISTS run_summaries (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        FOREIGN KEY(id) REFERENCES runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_run_summaries_updated_at
        ON run_summaries(updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_run_summaries_status_updated_at
        ON run_summaries(status, updated_at DESC);
    `);

    this.database
      .prepare(
        `
        INSERT OR IGNORE INTO schema_migrations (version, name)
        VALUES (?, ?)
      `,
      )
      .run(1, "create-run-snapshot-tables");
  }

  private upsertSummary(summary: RunSummary): void {
    this.database
      .prepare(
        `
        INSERT INTO run_summaries (
          id,
          status,
          revision,
          updated_at,
          summary_json
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          revision = excluded.revision,
          updated_at = excluded.updated_at,
          summary_json = excluded.summary_json
      `,
      )
      .run(
        summary.id,
        summary.status,
        summary.revision,
        summary.updatedAt,
        JSON.stringify(summary),
      );
  }

  private currentRevision(runId: RunId): number {
    const row = this.database.prepare("SELECT revision FROM runs WHERE id = ?").get(runId);

    if (row === undefined) {
      throw new RunNotFoundError(runId);
    }

    const revision = getNumberColumn(row, "revision");

    return revision;
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");

    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error: unknown) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the original error.
      }

      throw error;
    }
  }
}

function serializeRun(run: RunManifest): string {
  return JSON.stringify(run, null, 2);
}

function getStringColumn(row: unknown, column: string): string {
  if (typeof row !== "object" || row === null || !(column in row)) {
    throw new Error(`SQLite row is missing column ${column}`);
  }

  const value = (row as Record<string, unknown>)[column];

  if (typeof value !== "string") {
    throw new Error(`SQLite column ${column} is not a string`);
  }

  return value;
}

function getNumberColumn(row: unknown, column: string): number {
  if (typeof row !== "object" || row === null || !(column in row)) {
    throw new Error(`SQLite row is missing column ${column}`);
  }

  const value = (row as Record<string, unknown>)[column];

  if (typeof value !== "number") {
    throw new Error(`SQLite column ${column} is not a number`);
  }

  return value;
}

function isSqliteConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    ("code" in error || "message" in error) &&
    (String((error as { code?: unknown }).code).includes("SQLITE_CONSTRAINT") ||
      error.message.includes("UNIQUE constraint failed"))
  );
}
