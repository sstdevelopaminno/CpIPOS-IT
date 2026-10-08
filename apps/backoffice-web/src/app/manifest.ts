import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/it-admin",
    name: "CpiPOS IT Control Plane",
    short_name: "CpiPOS IT",
    description: "CpiPOS IT Admin and Support Control Plane",
    start_url: "/it-admin",
    scope: "/",
    display: "standalone",
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
