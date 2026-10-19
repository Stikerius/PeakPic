import { SplashScreen, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { colors, navigationTheme } from "@/constants/theme";
import { SessionProvider, useSession } from "@/lib/session";

// Keep the splash screen up until the stored session has been restored.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SessionProvider>
        <ThemeProvider value={navigationTheme}>
          <StatusBar style="light" />
          <RootNavigator />
        </ThemeProvider>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { session, loading } = useSession();

  useEffect(() => {
    if (!loading) void SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null;

  const signedIn = session !== null;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
