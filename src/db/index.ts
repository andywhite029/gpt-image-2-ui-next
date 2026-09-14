import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

const DB_PATH = process.env.DATABASE_PATH || "data/app.db";
const ABS_DB_PATH = path.resolve(process.cwd(), DB_PATH);

// 确保 data 目录存在
fs.mkdirSync(path.dirname(ABS_DB_PATH), { recursive: true });

const client = createClient({
  url: `file:${ABS_DB_PATH}`,
});

export const db = drizzle(client, { schema });
export type DB = typeof db;
export { schema, client };