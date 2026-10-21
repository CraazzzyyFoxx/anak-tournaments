import { execFileSync } from "node:child_process";
import path from "node:path";

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8090";
export const COOKIE_PREFIX = process.env.E2E_COOKIE_PREFIX ?? "owt";
export const AUTH_DIR = path.join(import.meta.dirname, "..", ".auth");
export const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..");
export const ADMIN_FILE = path.join(AUTH_DIR, "admin.json");
export const ADMIN_STATE = path.join(AUTH_DIR, "admin-state.json");

const COMPOSE = ["compose", "-p", "owt-e2e", "-f", "docker-compose.yml", "-f", "docker-compose.e2e.yml"];

/** Runs SQL against the isolated e2e database. Never available in the read-only project. */
export function sql(statement: string): string {
  return execFileSync(
    "docker",
    [...COMPOSE, "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "anak_e2e", "-tAc", statement],
    { cwd: REPO_ROOT, encoding: "utf8" }
  ).trim();
}
