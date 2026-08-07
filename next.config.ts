import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // public/model/ (issue #18) is the largest asset in the app and every participant downloads
  // it on the stall's shared Wi-Fi. A day-long cache means a repeat visitor (or a phone that
  // reloads the page mid-event) doesn't re-fetch it. Not `immutable`: the model may still be
  // swapped before the freeze, and this event's shelf life is a single day anyway.
  async headers() {
    return [
      {
        source: "/model/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
  // Silences the build warning about a package-lock.json in C:\Users\ADMIN being ignored.
  // Requires an absolute path (issue #42).
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
