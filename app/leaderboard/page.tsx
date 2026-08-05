/**
 * Stall leaderboard. Server component: it fetches the aggregate view so the first paint is
 * populated even if the Realtime socket is slow, then hands the rows to a client child that
 * subscribes to game_results INSERTs and refetches (debounced), falling back to a 10s poll if
 * the socket drops. See docs/02-architecture.md § 9.
 *
 * Mobile portrait board only for v1. The landscape stall layout is deferred until a dedicated
 * screen is confirmed — see docs/03-design-system.md § 3.6.
 */
export default function LeaderboardPage() {
  // TODO: read the one aggregate view here — not five queries. Anon has no raw SELECT on
  // participants or game_results, so the view is the only readable surface.
  return (
    <main className="flex min-h-dvh flex-col gap-6 px-4 py-6">
      <h1 className="text-2xl font-bold text-ieee-blue">Leaderboard</h1>

      {/* TODO: headline stats (fastest guess, games played) as large glanceable numbers, then
          the ranked list. Labels self-explanatory without a legend. */}
      <p className="text-ink-muted">Ranked list goes here.</p>
    </main>
  );
}
