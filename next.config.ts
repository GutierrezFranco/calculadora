import type { NextConfig } from "next";

// Sin Cache Components: casi todas las pantallas dependen del usuario logueado
// y tienen que mostrar los datos al día.
const nextConfig: NextConfig = {
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
