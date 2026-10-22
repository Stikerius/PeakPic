import { ThemeProvider as NavigationThemeProvider, SplashScreen, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { ReportProvider } from "@/components/moderation/report-provider";
import { navigationThemeFor } from "@/constants/theme";
import { AccountStatusProvider, useAccountStatus } from "@/lib/accountStatus";
import { LegalGateProvider, useLegalGate } from "@/lib/legalGate";
import { OnboardingProvider, useOnboarding } from "@/lib/onboarding";
import { SessionProvider, useSession } from "@/lib/session";
import { ThemeProvider, makeStyles, useTheme } from "@/lib/theme";
import { startUsageTracking } from "@/lib/usage";

// Keep the splash screen up until the stored session has been restored.
void SplashScreen.preventAutoHideAsync();
// Anonymous usage counters: counted on the device, sent in batches (lib/usage.ts).
startUsageTracking();

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ThemedRoot>
        <SessionProvider>
          <AccountStatusProvider>
            <LegalGateProvider>
              <OnboardingProvider>
                <ReportProvider>
                  <RootNavigator />
                </ReportProvider>
              </OnboardingProvider>
            </LegalGateProvider>
          </AccountStatusProvider>
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
  const styles = useStyles();
  const { session, loading } = useSession();
  const { needed: onboardingNeeded } = useOnboarding();
  const { account } = useAccountStatus();
  const legal = useLegalGate();
  const signedIn = session !== null;
  // A suspended, banned or deleting account only gets the "Konto gesperrt" screen.
  const locked = signedIn && account !== null && account.status !== "active";
  // Splash stays up until we know the account status and whether the intro comes first
  // (each check gives up after a few seconds).
  // Current legal texts that still need a confirmation come before the intro and the app.
  const legalNeeded = signedIn && !locked && legal.needed;
  const ready =
    !loading &&
    !(signedIn && (account === null || (!locked && (legal.status === null || onboardingNeeded === null))));

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) {
    // Right after a login the splash is gone already: show that something is happening.
    return loading ? null : (
      <View style={[styles.root, styles.centered]}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontSize: 17, fontWeight: "600" },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      {/* Login first, then the account status, then the intro (if not done yet), then the app. */}
      <Stack.Protected guard={signedIn && !locked && !legalNeeded && onboardingNeeded !== true}>
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
        <Stack.Screen name="delete-account" options={{ title: "Konto löschen" }} />
        <Stack.Screen name="profile-edit" options={{ title: "Profil bearbeiten", presentation: "modal" }} />
        <Stack.Screen name="plan-edit" options={{ title: "Trainingspläne" }} />
        <Stack.Screen name="plan-editor/[planId]" options={{ title: "Plan bearbeiten", presentation: "modal" }} />
        <Stack.Screen name="privacy/[scope]" options={{ title: "" }} />
        <Stack.Screen name="app-icon" options={{ title: "App-Icon" }} />
        <Stack.Screen name="blocked-accounts" options={{ title: "Blockierte Konten" }} />
        <Stack.Screen name="my-reports" options={{ title: "Meine Meldungen" }} />
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
      <Stack.Protected guard={signedIn && !locked && !legalNeeded}>
        {/* Also reachable later from the settings ("Einführung nochmal ansehen"). */}
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false, animation: "fade" }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !locked}>
        {/* The gate after login, and reachable from the legal update notice. */}
        <Stack.Screen name="legal-update" options={{ headerShown: false, gestureEnabled: false, animation: "fade" }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && locked}>
        <Stack.Screen name="account-locked" options={{ headerShown: false, gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      {/* Legal texts are readable in every state: signed out, in the gate, while suspended. */}
      <Stack.Screen name="legal/[docType]" options={{ title: "", presentation: "modal" }} />
    </Stack>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centered: {
      alignItems: "center",
      justifyContent: "center",
    },
  }),
);
