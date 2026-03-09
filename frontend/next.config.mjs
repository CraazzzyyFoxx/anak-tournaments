/** @type {import('next').NextConfig} */
const nextConfig = {
  // Only use standalone output in production builds
  ...(process.env.NODE_ENV === 'production' && { output: "standalone" }),
  async rewrites() {
    const apiUrl = process.env.NEXT_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
  images: {
    qualities: [25, 50, 75, 100],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'd15f34w2p8l1cc.cloudfront.net',
        port: '',
        pathname: '/overwatch/**',
      },
      {
        protocol: 'https',
        hostname: 'overfast.craazzzyyfoxx.me',
        port: '',
        pathname: '/static/**',
      },
      {
        protocol: 'https',
        hostname: 'img.clerk.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'cdn.discordapp.com',
        port: '',
        pathname: '/**',
      }
    ],
  },
};

export default nextConfig;
