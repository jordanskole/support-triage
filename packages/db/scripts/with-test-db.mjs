// Runs a command with DATABASE_URL pointed at DATABASE_URL_TEST.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync("../../.env")) process.loadEnvFile("../../.env");

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  console.error("DATABASE_URL_TEST is not set");
  process.exit(1);
}

const [cmd, ...args] = process.argv.slice(2);
const result = spawnSync(cmd, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, DATABASE_URL: testUrl },
});
process.exit(result.status ?? 1);
