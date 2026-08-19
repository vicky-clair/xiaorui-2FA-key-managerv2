import "../i18n";

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { DatabaseProvider } from "../providers/DatabaseProvider";
import { ThemePreferenceProvider, useThemePreference } from "../providers/ThemePreferenceProvider";

SplashScreen.preventAutoHideAsync();

function InnerLayout() {
  const { isDark } = useThemePreference();
  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <DatabaseProvider>
        <AnimatedSplashOverlay />
        <Stack screenOptions={{ headerShown: false }} />
      </DatabaseProvider>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemePreferenceProvider>
      <InnerLayout />
    </ThemePreferenceProvider>
  );
}
