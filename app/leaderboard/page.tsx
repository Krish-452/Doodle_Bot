import React from "react";
import { fetchLeaderboard } from "../../lib/data";
import { LeaderboardClient } from "./LeaderboardClient";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const initialSnapshot = await fetchLeaderboard();

  return <LeaderboardClient initialSnapshot={initialSnapshot} />;
}
