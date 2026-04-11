import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";
import tailwindcss from "@tailwindcss/vite";
import remarkGfm from "remark-gfm";
import {
  createVaultResolver,
  remarkObsidianCallouts,
  remarkObsidianLinksAndEmbeds,
  remarkSoftLineBreaks,
  remarkReadingTime,
  remarkResolveRelativeAssets,
} from "./scripts/markdown-utils.mjs";

const vaultResolver = createVaultResolver(new URL("./vault/", import.meta.url));

export default defineConfig({
  adapter: vercel(),
  output: "server",
  security: {
    checkOrigin: false,
  },
  vite: {
    plugins: [tailwindcss()],
  },
  markdown: {
    remarkPlugins: [
      remarkGfm,
      remarkSoftLineBreaks,
      remarkReadingTime,
      [remarkObsidianLinksAndEmbeds, { resolver: vaultResolver }],
      remarkObsidianCallouts,
      [remarkResolveRelativeAssets, { resolver: vaultResolver }],
    ],
    shikiConfig: {
      theme: "github-dark-default",
      wrap: true,
    },
  },
});
