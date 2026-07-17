import { Pool } from "pg";
import { config } from "./config";

// Single shared pool. Route handlers should go through a service or the legacy
// query helpers rather than using this directly (not everything does yet).
export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
