import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Old section routes, kept working for bookmarks and shared links. Query strings carry over.
  async redirects() {
    return [
      { source: "/projects/:id", destination: "/progress/records?project=:id", permanent: false },
      { source: "/field", destination: "/work?source=field", permanent: false },
      { source: "/procurement", destination: "/work?source=procurement", permanent: false },
      // Tasks was renamed Work.
      { source: "/tasks", destination: "/work", permanent: false },
      { source: "/tasks/:path*", destination: "/work/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
