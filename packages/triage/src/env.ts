/** Reads the named variables, or throws one error listing every one that is missing. */
export function requireEnv<const N extends string>(
  names: readonly N[],
  env: Record<string, string | undefined> = process.env,
): Record<N, string> {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")} (set them in .env)`);
  }
  return Object.fromEntries(names.map((name) => [name, env[name]])) as Record<N, string>;
}
