/** @type {import('next').NextConfig} */
const nextConfig = {
  // The proofscan tool is never imported into the web bundle. The scan runs in
  // a separate Node process (scripts/run-scan.mjs) that imports it natively, so
  // there is nothing here to externalize.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
