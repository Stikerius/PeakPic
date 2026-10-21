import { ThemeProvider as NavigationThemeProvider, SplashScreen, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { navigationThemeFor } from "@/constants/theme";
import { SessionProvider, useSession } from "@/lib/session";
import { ThemeProvider, makeStyles, useTheme } from "@/lib/theme";

// Keep the splash screen up until the stored session has been restored.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ThemedRoot>
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      </ThemedRoot>
    </ThemeProvider>
  );
}

/** Hands the active scheme to the navigator, status bar and native root view. */
function ThemedRoot({ children }: { children: ReactNode }) {
  const { scheme, colors } = useTheme();
  const styles = useStyles();

  useEffect(() => {
    // Root view colour behind screens, visible during transitions and modals.
    void SystemUI.setBackgroundColorAsync(colors.background);
  }, [colors.background]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <NavigationThemeProvider value={navigationThemeFor(scheme)}>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        {children}
      </NavigationThemeProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { colors } = useTheme();
  const { session, loading } = useSession();

  useEffect(() => {
    if (!loading) void SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null;

  const signedIn = session !== null;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontSize: 17, fontWeight: "600" },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="search" options={{ title: "Leute finden", presentation: "modal" }} />
        <Stack.Screen
          name="comments/[postId]"
          options={{
            headerShown: false,
            presentation: "transparentModal",
            animation: "fade",
            contentStyle: { backgroundColor: "transparent" },
          }}
        />
        <Stack.Screen
          name="share/[postId]"
          options={{ title: "Senden an", presentation: "modal" }}
        />
        <Stack.Screen name="day/[date]" options={{ title: "", presentation: "modal" }} />
        <Stack.Screen name="chats/new" options={{ title: "Neuer Chat", presentation: "modal" }} />
        <Stack.Screen name="chats/[conversationId]" options={{ title: "", headerBackTitle: "Chats" }} />
        <Stack.Screen name="post/[postId]" options={{ title: "Post", presentation: "modal" }} />
        <Stack.Screen name="highlight/[highlightId]" options={{ title: "Highlight", presentation: "modal" }} />
        <Stack.Screen name="follows/[userId]" options={{ title: "", presentation: "modal" }} />
        <Stack.Screen name="follow-requests" options={{ title: "Follower-Anfragen" }} />
        <Stack.Screen name="hashtag/[tag]" options={{ title: "", presentation: "modal" }} />
        <Stack.Screen name="repost/[postId]" options={{ title: "Selbst posten", presentation: "modal" }} />
        <Stack.Screen name="post-links/[postId]" options={{ title: "Verlinkungen & Reposts", presentation: "modal" }} />
        <Stack.Screen name="user/[userId]" options={{ title: "" }} />
        <Stack.Screen name="notifications" options={{ title: "Mitteilungen" }} />
        <Stack.Screen name="settings" options={{ title: "Einstellungen", headerBackTitle: "Profil" }} />
        <Stack.Screen name="profile-edit" options={{ title: "Profil bearbeiten", presentation: "modal" }} />
        <Stack.Screen name="privacy/[scope]" options={{ title: "" }} />
        <Stack.Screen name="app-icon" options={{ title: "App-Icon" }} />
        <Stack.Screen
          name="post-create"
          options={{ headerShown: false, presentation: "fullScreenModal", gestureEnabled: false }}
        />
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

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
  }),
);
