export default async function (): Promise<void> {
  // This is intentional: because global-setup.ts calls `.withReuse()`, Testcontainers keeps
  // containers running across test runs for fast local iteration, so there is nothing to tear down here.
  // Do not add container.stop() calls.
}
