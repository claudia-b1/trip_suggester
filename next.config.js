// Corporate proxy / SSL inspection fix — only in development.
// Remove this block if deploying to a trusted environment.
if (process.env.NODE_ENV !== "production") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["react-map-gl", "mapbox-gl"],
};
module.exports = nextConfig;