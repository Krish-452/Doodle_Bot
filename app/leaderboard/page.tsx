import React from "react";
import { fetchLeaderboard } from "../../lib/data";
import { LeaderboardClient } from "./LeaderboardClient";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const initialLeaderboard = await fetchLeaderboard();

  return <LeaderboardClient initialLeaderboard={initialLeaderboard} />;
}
