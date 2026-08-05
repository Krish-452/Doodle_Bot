# DoodleBot 🤖🎨

> Browser-based AI-powered Pictionary for IEEE Ahmedabad University Student Branch — Club Carnival

DoodleBot is a zero-install, mobile-first web game where carnival attendees draw a target word on their phone and a real-time computer vision model guesses it live. Scores feed a stall-facing live leaderboard.

---

## 🚀 Features

- **Zero-Friction Onboarding**: Scan QR code → Enter Name → Start playing in < 10s.
- **Single-Route State Machine (`/play`)**: `word-select → countdown → drawing → result → word-select`. Canvas DOM & model stay loaded across rounds.
- **Real-Time AI Inference**: TensorFlow.js CNN downsamples canvas drawings to 28×28 grayscale tensors with inverted ink polarity, processing predictions every 400ms.
- **IEEE Brand Aesthetic**: Styled with IEEE Master Blue (`#00629b`), high contrast, and responsive `100dvh` layout.
- **Live Leaderboard (`/leaderboard`)**: Real-time cross-tab sync via `BroadcastChannel` and 3-second fallback polling, showing total plays, wins, and fastest times.
- **Offline Durability**: Automatic `localStorage` queue sync so gameplay works seamlessly offline or on poor stall Wi-Fi.

---

## 🛠️ Stack

- **Framework**: Next.js 16 (App Router + Turbopack)
- **Language**: TypeScript (strict)
- **Styling**: Vanilla CSS + Tailwind CSS v4 (`@theme` design tokens)
- **Inference**: TensorFlow.js (`@tensorflow/tfjs`) in-browser classification
- **Storage & Sync**: LocalStorage Queue + BroadcastChannel + Supabase client fallback

---

## 📖 Development & Build

```bash
# Install dependencies
npm install

# Start local dev server
npm run dev

# Run TypeScript type check
npm run typecheck

# Build for production
npm run build
```

---

## 🎯 Resolved Issues & Milestones

- **Fixes #10**: State machine & persistent canvas session in `/play`
- **Fixes #11**: Landing page, name validation, word selection, and countdown overlay
- **Fixes #13**: Results screen, duration & rank computation, instant handoff, Play Again loop
- **Fixes #15**: Shared UI primitives (`ScreenShell`, `Button`, `Card`) & IEEE branding pass
