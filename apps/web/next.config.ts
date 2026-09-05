import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@1apply/contracts", "@1apply/domain", "@1apply/form-engine"],
  serverExternalPackages: ["mammoth", "puppeteer"],
  poweredByHeader: false,
  eslint: {
    // On 2GB EC2, run lint separately; build uses scripts/ec2-build.sh
    ignoreDuringBuilds: process.env.LOW_MEM_BUILD === "1",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
