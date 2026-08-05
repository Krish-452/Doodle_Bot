# DoodleBot — Event Ops & Launch Playbook

**IEEE Ahmedabad University Student Branch — Club Carnival**

> Source: `DoodleBot.pdf`, section 4. Checklists compressed for a 2-day build.

---

## 1. Purpose

The [PRD](01-prd.md), [Architecture](02-architecture.md), and [Design System](03-design-system.md)
cover what DoodleBot is and how it's built. This doc covers what happens on the ground — logistics,
staffing, and the pre/during/post-event checklist — so the build team and stall volunteers are
aligned on execution.

---

## 2. Physical setup

- **QR code posters at high-traffic points around the venue** — entrances, adjacent stalls, the
  main walkway. Not just at the IEEE stall itself. The point is to pull people in from a distance.
- **One dedicated screen/monitor at the stall** running `/leaderboard` continuously, in landscape.
- **Stable internet at the stall.** Confirm venue Wi-Fi capability in advance; carry a mobile
  hotspot as backup.
- **Signage at the stall** reinforcing "Scan. Draw. Beat the AI." alongside the QR code, for people
  who are already standing there.

### QR code notes

- Point it at the bare origin (`https://doodlebot.<domain>`), not a deep link with query params.
  Shorter URL → denser-readable QR code → scans from further away.
- Print at a size readable from ~1.5m. Test the printed poster with a real phone before duplicating.
- HTTPS is required. Some Android QR scanners refuse plain HTTP.

---

## 3. Staffing

**1–2 volunteers at the stall at all times** during carnival hours, to:

- Guide first-time participants through the QR scan
- Encourage replay and explain the leaderboard
- Handle basic troubleshooting ("my drawing isn't loading")

**1 technical owner**, on-call and not necessarily stationed at the stall, responsible for:

- Monitoring backend/leaderboard uptime
- Restarting services if something breaks
- Handling any last-minute fixes

If Club Carnival spans multiple days or long hours, run a simple shift schedule so volunteer
attention stays fresh.

### Volunteer briefing — the 60-second version

> People scan the QR, type a name, pick one of three words, and draw it. The AI guesses while they
> draw. If it gets it, they win and their time goes on the board. Push them to play again — the
> leaderboard rewards repeat play, not just one lucky fast round.

**Common issues and fixes:**

| Symptom | Fix |
| --- | --- |
| "Nothing loads after scanning" | Check their phone is on a working network. Try the URL typed manually |
| "The AI never guesses anything" | First load may still be downloading the model. Wait ~5s. If it persists across multiple people, flag the technical owner — likely a word bank issue |
| "My drawing doesn't appear" | Almost always a stale browser tab. Hard refresh |
| Leaderboard screen frozen | Refresh the page. If it recurs, flag the technical owner |

---

## 4. Pre-event checklist

Adapted for the 2-day build. Items the original 4-week plan assumed are marked where cut.

- [ ] Word bank finalized and tested against the AI model for recognition reliability
- [ ] Full flow tested end-to-end on **real** iOS Safari and Android Chrome hardware (not just
      desktop devtools emulation — touch drawing behaves differently)
- [ ] Leaderboard ranking formula finalized and verified with sample data
- [ ] IEEE branding assets (logo, colors, palette) applied and reviewed across all screens
- [ ] QR code posters printed and distribution locations planned
- [ ] Printed QR tested by scanning from ~1.5m with a real phone
- [ ] Backup internet (hotspot) arranged
- [ ] Stall display screen and mount/stand arranged
- [ ] Leaderboard tested on the **actual** stall screen at its real resolution
- [ ] Volunteer shifts assigned and briefed
- [ ] Supabase RLS policies verified — anon can insert results and read the leaderboard, and
      nothing else
- [ ] Deployment frozen at end of Day 2

**Cut from the original checklist, with risk accepted:**

- ~~Load test at 20–30 concurrent sessions~~ — client-side inference keeps the server at two writes
  and one read per game. Low risk, but untested.
- ~~24–48 hour change freeze~~ — compressed to a same-night freeze.
- ~~Volunteer dry run~~ — replaced by the briefing above.

---

## 5. During-event monitoring

- Periodically confirm the leaderboard is updating live. This is the visible signal that the
  backend is healthy.
- Watch for **repeated failed sessions** — several participants in a row reporting the AI never
  guesses. This usually means a word bank or model problem, not a bug. The fastest fix is removing
  the offending word from the bank and redeploying.
- Keep a lightweight incident log: what broke, when, how it was resolved. This feeds the post-event
  review.

### Escalation

| Situation | Action |
| --- | --- |
| One participant's phone misbehaving | Volunteer handles. Refresh, retry |
| Several participants failing on the same word | Note the word. Technical owner removes it from the bank and redeploys |
| Leaderboard not updating | Technical owner checks Supabase dashboard for connection/quota issues |
| Site fully down | Technical owner checks the host's deploy status. Roll back to the last known-good deployment |
| Venue internet down | Gameplay still works — it is fully client-side. Results queue locally and sync on reconnect. Tell volunteers to keep people playing |

---

## 6. Post-event

- **Export the final leaderboard data** as a record of engagement. Useful for the committee report
  and future proposals.
- **Debrief with volunteers:** what confused participants, what drove the most repeat play, what to
  change next time.
- **Archive word bank performance notes** — which words the AI struggled with — to improve future
  iterations. If per-word failure data wasn't captured in the DB, capture it from volunteer notes
  before memory fades.

---

## 7. Success review criteria

Assess against the [PRD's success metrics](01-prd.md#2-goals-and-success-metrics):

- Total unique participants vs. the 500–600 footfall target
- Games-per-participant ratio (the repeat-play signal)
- Peak concurrency handled without degradation
- Qualitative volunteer feedback on stall engagement and crowd-pulling effect

This review feeds directly into the committee report and any future-iteration proposal.
