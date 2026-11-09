import type { MetadataRoute } from "next";

/** Installs ROP Workflow on a phone's home screen; it opens without a connection (public/sw.js). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ROP Workflow",
    short_name: "ROP Workflow",
    description: "Field results, evidence and donor reports for Roots of Peace projects.",
    start_url: "/home",
    display: "standalone",
    background_color: "#f4f1e8",
    theme_color: "#1f4d36",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
