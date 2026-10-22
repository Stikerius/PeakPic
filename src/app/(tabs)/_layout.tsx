import Ionicons from "@expo/vector-icons/Ionicons";
import { Link, router, Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { useEffect } from "react";
import { Alert, Pressable, StyleSheet, View, type ColorValue } from "react-native";

import { NewChatButton } from "@/components/chat/new-chat-button";
import { NotificationBell } from "@/components/notification-bell";
import { spacing } from "@/constants/theme";
import { useFollowRequestCount } from "@/hooks/use-follow-requests";
import { useUnreadChatCount } from "@/hooks/use-unread-chats";
import { makeStyles, useTheme } from "@/lib/theme";
import { clearTrainingDraft, loadTrainingDraft } from "@/lib/trainingDraft";
import { isStale } from "@/lib/workout";

// Once per app start: offer to continue a training that is still on the device.
let resumePromptShown = false;

function useResumeTrainingPrompt() {
  useEffect(() => {
    if (resumePromptShown) return;
    resumePromptShown = true;
    void loadTrainingDraft().then((draft) => {
      if (draft === null) return;
      if (isStale(draft, Date.now())) {
        Alert.alert(
          "Unbeendetes Training",
          "Ein Training von vor über 12 Stunden ist noch nicht gespeichert. Beenden und speichern oder verwerfen?",
          [
            { text: "Später", style: "cancel" },
            {
              text: "Verwerfen",
              style: "destructive",
              onPress: () =>
                Alert.alert("Wirklich verwerfen?", "Alle erfassten Sätze dieses Trainings gehen verloren.", [
                  { text: "Abbrechen", style: "cancel" },
                  { text: "Verwerfen", style: "destructive", onPress: () => void clearTrainingDraft() },
                ]),
            },
            { text: "Beenden", onPress: () => router.push("/workout-finish") },
          ],
        );
        return;
      }
      Alert.alert("Training fortsetzen?", "Dein letztes Training ist noch nicht beendet.", [
        { text: "Später", style: "cancel" },
        {
          text: "Fortsetzen",
          onPress: () => router.push(draft.endedAt !== null ? "/workout-finish" : "/workout-session"),
        },
      ]);
    });
  }, []);
}

type IoniconName = ComponentProps<typeof Ionicons>["name"];

type TabIconProps = {
  focused: boolean;
  color: ColorValue;
  size: number;
};

function tabIcon(active: IoniconName, inactive: IoniconName) {
  return function TabIcon({ focused, color, size }: TabIconProps) {
    return (
      <Ionicons name={focused ? active : inactive} color={color} size={size} />
    );
  };
}

function SettingsButton() {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Link href="/settings" asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Einstellungen"
        hitSlop={spacing.sm}
        style={styles.headerActions}
      >
        <Ionicons name="settings-outline" size={22} color={colors.text} />
      </Pressable>
    </Link>
  );
}

function FeedHeaderActions() {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.headerActions}>
      <Link href="/search" asChild>
        <Pressable accessibilityRole="button" accessibilityLabel="Leute finden" hitSlop={spacing.sm}>
          <Ionicons name="person-add-outline" size={22} color={colors.text} />
        </Pressable>
      </Link>
      <NotificationBell />
    </View>
  );
}

function HomeHeaderActions() {
  const styles = useStyles();
  return (
    <View style={styles.headerActions}>
      <NotificationBell />
    </View>
  );
}

export default function TabLayout() {
  const { colors } = useTheme();
  const unreadChats = useUnreadChatCount();
  const followRequests = useFollowRequestCount();
  useResumeTrainingPrompt();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontSize: 17, fontWeight: "600" },
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        // Short cross-fade between tabs instead of a hard cut.
        animation: "fade",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: tabIcon("home", "home-outline"),
          headerRight: () => <HomeHeaderActions />,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: "Feed",
          tabBarIcon: tabIcon("people", "people-outline"),
          headerRight: () => <FeedHeaderActions />,
        }}
      />
      <Tabs.Screen
        name="camera"
        options={{
          title: "Kamera",
          headerShown: false,
          tabBarIcon: tabIcon("camera", "camera-outline"),
        }}
      />
      <Tabs.Screen
        name="training"
        options={{
          title: "Training",
          tabBarIcon: tabIcon("barbell", "barbell-outline"),
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: "Chats",
          tabBarIcon: tabIcon("chatbubbles", "chatbubbles-outline"),
          tabBarBadge: unreadChats > 0 ? unreadChats : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.accent, color: colors.onAccent, fontSize: 11, fontWeight: "600" },
          headerRight: () => <NewChatButton />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profil",
          tabBarIcon: tabIcon("person", "person-outline"),
          tabBarBadge: followRequests > 0 ? followRequests : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.accent, color: colors.onAccent, fontSize: 11, fontWeight: "600" },
          headerRight: () => <SettingsButton />,
        }}
      />
    </Tabs>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.lg,
      paddingHorizontal: spacing.md,
    },
  }),
);
