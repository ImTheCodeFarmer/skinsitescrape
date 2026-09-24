export async function register() {
  // Warm the shared query cache in the server process; skip the build and the edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build" || !process.env.DATABASE_URL) return;
  const { startWarming } = await import("./lib/warm");
  startWarming();
}
