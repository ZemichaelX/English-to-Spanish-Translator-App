import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Habla",
    short_name: "Habla",
    description: "Face to face Spanish and English voice translator",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#161819",
    theme_color: "#161819",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
