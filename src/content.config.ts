import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

function normalizeString(value: unknown, maxLength?: number) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return maxLength ? text.slice(0, maxLength) : text;
}

function normalizeDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value < 1e12 ? value * 1000 : value);
    if (!Number.isNaN(date.getTime())) return date;
  }

  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return undefined;

    const normalized = raw
      .replace(/[./]/g, "-")
      .replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");

    const date = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
      ? new Date(`${normalized}T00:00:00`)
      : new Date(normalized);

    if (!Number.isNaN(date.getTime())) return date;
  }

  return undefined;
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeString(item))
      .filter((item): item is string => Boolean(item));
  }

  if (typeof value === "string") {
    return value
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(text)) return true;
    if (["false", "0", "no", "n", ""].includes(text)) return false;
  }
  return false;
}

const notes = defineCollection({
  loader: glob({
    base: "./vault",
    pattern: "**/*.md",
  }),
  schema: z.object({
    title: z.preprocess((value) => normalizeString(value), z.string().optional()),
    date: z.preprocess(normalizeDate, z.date().optional()),
    updated: z.preprocess(normalizeDate, z.date().optional()),
    description: z.preprocess(
      (value) => normalizeString(value, 240),
      z.string().optional(),
    ),
    tags: z.preprocess(normalizeTags, z.array(z.string())),
    draft: z.preprocess(normalizeBoolean, z.boolean()),
  }),
});

export const collections = { notes };
