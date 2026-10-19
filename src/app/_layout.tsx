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
        <Stack.Screen name="search" options={{ title: "Leute finden", presentation: "modal" }} />
        <Stack.Screen
          name="comments/[postId]"
          options={{ title: "Kommentare", presentation: "modal" }}
        />
        <Stack.Screen
          name="share/[postId]"
          options={{ title: "Senden an", presentation: "modal" }}
        />
        <Stack.Screen name="day/[date]" options={{ title: "", presentation: "modal" }} />
        <Stack.Screen name="chats/new" options={{ title: "Neuer Chat", presentation: "modal" }} />
        <Stack.Screen name="chats/[conversationId]" options={{ title: "", headerBackTitle: "Chats" }} />
        <Stack.Screen name="post/[postId]" options={{ title: "Post" }} />
        <Stack.Screen name="user/[userId]" options={{ title: "" }} />
        <Stack.Screen name="notifications" options={{ title: "Mitteilungen" }} />
        <Stack.Screen name="settings" options={{ title: "Einstellungen", headerBackTitle: "Profil" }} />
        <Stack.Screen name="privacy/[scope]" options={{ title: "" }} />
        <Stack.Screen
          name="story-create"
          options={{ headerShown: false, presentation: "fullScreenModal", gestureEnabled: false }}
        />
        <Stack.Screen
          name="stories/[userId]"
          options={{ headerShown: false, presentation: "fullScreenModal", animation: "fade" }}
        />
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
