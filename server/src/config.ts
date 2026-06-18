import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, "../..");

export interface AppConfig {
  databasePath: string;
  fiscalApiKey: string | null;
  port: number;
  refreshConcurrency: number;
}

const DEFAULT_REFRESH_CONCURRENCY = 8;

export function getConfig(): AppConfig {
  return {
    databasePath: path.resolve(projectRoot, process.env.DATABASE_PATH ?? "./data/alphapane.db"),
    fiscalApiKey: process.env.FISCAL_API_KEY?.trim() || null,
    port: Number(process.env.PORT ?? 4317),
    refreshConcurrency: resolveConcurrency(process.env.REFRESH_CONCURRENCY)
  };
}

function resolveConcurrency(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_REFRESH_CONCURRENCY;
  return Math.floor(parsed);
}

