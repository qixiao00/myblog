import { createHash } from "node:crypto";

function md5(value: string) {
  return createHash("md5").update(value).digest("hex");
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function getAvatarByEmail(email: string, seedHint?: string) {
  const normalized = normalizeEmail(email);

  if (!normalized) {
    const fallbackSeed = seedHint?.trim() || "guest";
    return {
      avatarUrl: "",
      avatarFallbackUrl: `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(fallbackSeed)}`,
    };
  }

  const hash = md5(normalized);
  return {
    avatarUrl: `https://www.gravatar.com/avatar/${hash}?s=96&d=404&r=g`,
    avatarFallbackUrl: `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(hash)}`,
  };
}
