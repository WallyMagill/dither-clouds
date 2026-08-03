import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The page renders as full-bleed artwork with no chrome. Next's dev-mode
  // indicator sits on top of it in the bottom-left corner, so it would appear
  // in any screenshot taken from `npm run dev`.
  devIndicators: false,
};

export default nextConfig;
