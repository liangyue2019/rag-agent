import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../config.js";
import * as schema from "./schema.js";

const file = env.DATABASE_URL.replace(/^file:/, "");
mkdirSync(dirname(file), { recursive: true });
export const sqlite = new Database(file);
export const db = drizzle(sqlite, { schema });
