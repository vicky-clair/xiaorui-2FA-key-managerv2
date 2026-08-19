import "@/global.css";
import { Platform } from "react-native";

export const Colors = {
  light: {
    text: "#0f172a",
    background: "#f8fafc",
    backgroundElement: "#ffffff",
    backgroundSelected: "#f1f5f9",
    card: "#ffffff",
    cardBorder: "rgba(226, 232, 240, 0.9)",
    cardBorderHover: "#3b82f6",
    textSecondary: "#64748b",
    textDisabled: "#94a3b8",
    border: "#e2e8f0",
    inputBackground: "#ffffff",
    primary: "#2563eb",
    primaryHover: "#1d4ed8",
    accent: "#3b82f6",
    badgeBg: "rgba(37, 99, 235, 0.08)",
    badgeText: "#2563eb",
    danger: "#ef4444",
    dangerBg: "rgba(239, 68, 68, 0.08)",
    dangerBorder: "rgba(239, 68, 68, 0.2)",
    success: "#10b981",
    warning: "#f59e0b",
  },
  dark: {
    text: "#f8fafc",
    background: "#090d16",
    backgroundElement: "#111827",
    backgroundSelected: "#1e293b",
    card: "#111827",
    cardBorder: "rgba(255, 255, 255, 0.08)",
    cardBorderHover: "#3b82f6",
    textSecondary: "#94a3b8",
    textDisabled: "#475569",
    border: "rgba(255, 255, 255, 0.1)",
    inputBackground: "#1e293b",
    primary: "#3b82f6",
    primaryHover: "#60a5fa",
    accent: "#60a5fa",
    badgeBg: "rgba(59, 130, 246, 0.15)",
    badgeText: "#60a5fa",
    danger: "#ef4444",
    dangerBg: "rgba(239, 68, 68, 0.12)",
    dangerBorder: "rgba(239, 68, 68, 0.3)",
    success: "#10b981",
    warning: "#f59e0b",
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "ui-serif, Georgia, Cambria, serif",
    rounded: "ui-rounded, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 900;
