import type { NextConfig } from "next";

// Sin Cache Components: casi todas las pantallas dependen del usuario logueado
// y tienen que mostrar los datos al día.
const nextConfig: NextConfig = {
  // Identifica el código compilado, incluso si una pestaña sigue mostrando una versión anterior.
  env: { MDM_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "" },
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
