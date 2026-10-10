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
    // Bundle this CommonJS/ESM boundary so Vercel's runtime loader never
    // needs to require the ESM-only htmlparser2 package from sanitize-html.
    ssr: { noExternal: ["sanitize-html", "htmlparser2"] },
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
