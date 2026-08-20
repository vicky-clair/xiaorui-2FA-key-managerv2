import React, { createContext, useContext, useEffect, useState } from "react";
import { useColorScheme as useDeviceColorScheme } from "react-native";
import { Colors } from "@/constants/theme";

export type ColorSchemeType = "dark" | "light";

export type ThemeColors = typeof Colors.light | typeof Colors.dark;

interface ThemePreferenceContextType {
  colorScheme: ColorSchemeType;
  toggleColorScheme: () => void;
  setColorScheme: (scheme: ColorSchemeType) => void;
  colors: ThemeColors;
  isDark: boolean;
}

const ThemePreferenceContext = createContext<ThemePreferenceContextType>({
  colorScheme: "dark",
  toggleColorScheme: () => {},
  setColorScheme: () => {},
  colors: Colors.dark,
  isDark: true,
});

export const ThemePreferenceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const deviceScheme = useDeviceColorScheme();
  const [colorScheme, setColorSchemeState] = useState<ColorSchemeType>("dark");

  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const saved = window.localStorage.getItem("sa_theme_mode") as ColorSchemeType | null;
        if (saved === "light" || saved === "dark") {
          setColorSchemeState(saved);
          return;
        }
      }
    } catch {}

    if (deviceScheme === "light" || deviceScheme === "dark") {
      setColorSchemeState(deviceScheme);
    }
  }, [deviceScheme]);

  const setColorScheme = (newScheme: ColorSchemeType) => {
    setColorSchemeState(newScheme);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem("sa_theme_mode", newScheme);
      }
    } catch {}
  };

  const toggleColorScheme = () => {
    const next = colorScheme === "dark" ? "light" : "dark";
    setColorScheme(next);
  };

  const colors = Colors[colorScheme];
  const isDark = colorScheme === "dark";

  return (
    <ThemePreferenceContext.Provider
      value={{
        colorScheme,
        toggleColorScheme,
        setColorScheme,
        colors,
        isDark,
      }}
    >
      {children}
    </ThemePreferenceContext.Provider>
  );
};

export const useThemePreference = () => useContext(ThemePreferenceContext);
