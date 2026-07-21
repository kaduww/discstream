import type { DiscType } from "@discstream/contracts";

export interface DrutilStatusInfo {
  hasDrive: boolean;
  mediaPresent: boolean;
  device?: string;
  typeText?: string;
  inferredDiscType: DiscType;
}

export function parseDrutilStatus(output: string): DrutilStatusInfo {
  const text = output.trim();
  if (!text || /no drives? found|no drive/i.test(text)) {
    return {
      hasDrive: false,
      mediaPresent: false,
      inferredDiscType: "none"
    };
  }

  const typeText = matchLineValue(text, "Type");
  const device = matchLineValue(text, "Name");
  const mediaPresent = Boolean(typeText && !/no media|empty/i.test(typeText));

  return {
    hasDrive: true,
    mediaPresent,
    device,
    typeText,
    inferredDiscType: mediaPresent ? inferDiscType(typeText) : "none"
  };
}

function matchLineValue(text: string, label: string): string | undefined {
  const match = new RegExp(`(?:^|\\s{2,})${label}:\\s*(.+?)(?:\\s{2,}[A-Z][A-Za-z\\s-]*:|$)`, "im").exec(text);
  return match?.[1]?.trim();
}

function inferDiscType(typeText: string | undefined): DiscType {
  if (!typeText) {
    return "unknown";
  }

  if (/audio|cd-da|cdda/i.test(typeText)) {
    return "audio-cd";
  }

  if (/dvd/i.test(typeText)) {
    return "dvd-video";
  }

  if (/cd|bd|disc|disk/i.test(typeText)) {
    return "data-disc";
  }

  return "unknown";
}
