import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Old section routes, kept working for bookmarks and shared links. Query strings carry over.
  async redirects() {
    return [
      { source: "/projects/:id", destination: "/progress/records?project=:id", permanent: false },
      { source: "/field", destination: "/tasks?source=field", permanent: false },
      { source: "/procurement", destination: "/tasks?source=procurement", permanent: false },
    ];
  },
};

export default nextConfig;
