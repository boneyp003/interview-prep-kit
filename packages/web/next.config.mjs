/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API base is read at runtime on the client from NEXT_PUBLIC_API_BASE.
  async rewrites() {
    const api = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${api}/:path*` }];
  },
};

export default nextConfig;
