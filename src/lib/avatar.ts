import { createHash } from "node:crypto";

function md5(value: string) {
  return createHash("md5").update(value).digest("hex");
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function getQqUinFromEmail(email: string) {
  const normalized = normalizeEmail(email);
  const match = normalized.match(/^(\d{5,12})@(qq|foxmail)\.com$/);
  return match?.[1] ?? "";
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

  const qqUin = getQqUinFromEmail(normalized);
  if (qqUin) {
    return {
      avatarUrl: `https://q1.qlogo.cn/g?b=qq&nk=${qqUin}&s=100`,
      avatarFallbackUrl: `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(qqUin)}`,
    };
  }

  const hash = md5(normalized);
  return {
    avatarUrl: `https://www.gravatar.com/avatar/${hash}?s=96&d=404&r=g`,
    avatarFallbackUrl: `https://www.libravatar.org/avatar/${hash}?s=96&d=identicon`,
  };
}
