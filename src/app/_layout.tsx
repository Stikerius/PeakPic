import { Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { colors, navigationTheme } from "@/constants/theme";

export default function RootLayout() {
  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: "Login" }} />
      </Stack>
    </ThemeProvider>
  );
}
