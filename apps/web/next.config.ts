import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@1apply/contracts", "@1apply/domain", "@1apply/form-engine"],
  serverExternalPackages: ["unpdf", "mammoth"],
  poweredByHeader: false,
};

export default nextConfig;
