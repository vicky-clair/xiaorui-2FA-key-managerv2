import { Colors } from "@/constants/theme";
import { useThemePreference } from "@/providers/ThemePreferenceProvider";

export function useTheme() {
  const { colors } = useThemePreference();
  return colors || Colors.dark;
}
