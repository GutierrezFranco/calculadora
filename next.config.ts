import type { NextConfig } from "next";

// Sin Cache Components: casi todas las pantallas dependen del usuario logueado
// y tienen que mostrar los datos al día.
const nextConfig: NextConfig = {
  // Las importaciones mandan hasta 5000 filas ya interpretadas.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
