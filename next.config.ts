import type { NextConfig } from "next";
import { releasePr } from "./src/domain/release";

// Sin Cache Components: casi todas las pantallas dependen del usuario logueado
// y tienen que mostrar los datos al día.
const nextConfig: NextConfig = {
  // Número del PR de esta compilación, no el último PR abierto en GitHub.
  env: { MDM_RELEASE_PR: String(releasePr(process.env.VERCEL_GIT_PULL_REQUEST_ID, process.env.VERCEL_GIT_COMMIT_MESSAGE)) },
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
