import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the OVH Docker image (deploy/web.Dockerfile).
  // Vercel ignores this setting.
  output: "standalone",
  allowedDevOrigins: ['192.168.109.70'],
  async redirects() {
    return [
      {
        source: "/tutor/sessions/:id/live",
        destination: "/tutor/classroom/:id",
        permanent: false,
      },
    ]
  },
};

export default nextConfig;
