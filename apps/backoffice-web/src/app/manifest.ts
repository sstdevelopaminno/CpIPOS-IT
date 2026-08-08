import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/?app=sstipos",
    name: "CpIPOS",
    short_name: "CpIPOS",
    description: "CpIPOS login + POS web app",
    start_url: "/login/store",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#071831",
    theme_color: "#0f2a4a",
    icons: [
      {
        src: "/icons/cpipos-icon-192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/icons/cpipos-icon-512.png",
        sizes: "512x512",
        type: "image/png"
      },
      {
        src: "/icons/cpipos-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
