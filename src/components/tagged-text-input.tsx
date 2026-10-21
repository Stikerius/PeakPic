import Ionicons from "@expo/vector-icons/Ionicons";
import { forwardRef, useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputProps,
  type TextInputSelectionChangeEventData,
  type ViewStyle,
} from "react-native";

import { Avatar } from "@/components/ui/avatar";
import { fontSize, onPhoto, radius, spacing, typography } from "@/constants/theme";
import { suggestHashtags, suggestPeople, type HashtagSuggestion } from "@/lib/tagSuggestRepo";
import { activeToken, applySuggestion, normalizeHashtag, type ActiveToken } from "@/lib/taggedText";
import { makeStyles, useTheme } from "@/lib/theme";
import type { PublicProfile } from "@/types/social";

const SUGGEST_DEBOUNCE_MS = 200;

type Suggestions =
  | { trigger: "@"; people: PublicProfile[] }
  | { trigger: "#"; tags: HashtagSuggestion[]; fresh: string | null };

type TaggedTextInputProps = Omit<TextInputProps, "value" | "onChangeText"> & {
  value: string;
  onChangeText: (text: string) => void;
  /** Where the suggestion list opens; "above" for inputs at the bottom of the screen. */
  suggestionsPlacement?: "above" | "below";
  containerStyle?: StyleProp<ViewStyle>;
  /** Dark list for inputs on photos (story / image text). */
  tone?: "default" | "dark";
};

/**
 * Text input with suggestions while typing "@name" (people) and "#tag" (existing hashtags
 * by use, or a new one). Picking one inserts "@username " / "#tag ". Used for comments,
 * captions, texts on photos and chat messages.
 */
export const TaggedTextInput = forwardRef<TextInput, TaggedTextInputProps>(function TaggedTextInput(
  { value, onChangeText, suggestionsPlacement = "above", containerStyle, tone = "default", onSelectionChange, ...inputProps },
  ref,
) {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const [cursor, setCursor] = useState(value.length);
  // Set once after inserting a suggestion, so the cursor lands behind it.
  const [forcedSelection, setForcedSelection] = useState<{ start: number; end: number } | undefined>(undefined);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const token: ActiveToken | null = activeToken(value, Math.min(cursor, value.length));

  const tokenKey = token === null ? null : `${token.trigger}${token.query}`;
  useEffect(() => {
    if (token === null) {
      setSuggestions(null);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      const load =
        token.trigger === "@"
          ? suggestPeople(token.query).then((people): Suggestions => ({ trigger: "@", people }))
          : suggestHashtags(token.query).then((tags): Suggestions => {
              const fresh = normalizeHashtag(token.query);
              return { trigger: "#", tags, fresh: fresh !== null && !tags.some((t) => t.tag === fresh) ? fresh : null };
            });
      load
        .then((result) => {
          if (active) setSuggestions(result);
        })
        .catch(() => {
          if (active) setSuggestions(null);
        });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [tokenKey]);

  function pick(insert: string) {
    if (token === null) return;
    const next = applySuggestion(value, token, insert);
    onChangeText(next.text);
    setCursor(next.cursor);
    setForcedSelection({ start: next.cursor, end: next.cursor });
    setSuggestions(null);
  }

  function handleSelection(event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) {
    setCursor(event.nativeEvent.selection.end);
    setForcedSelection(undefined);
    onSelectionChange?.(event);
  }

  const dark = tone === "dark";
  const rows =
    suggestions === null
      ? []
      : suggestions.trigger === "@"
        ? suggestions.people.map((person) => (
            <Pressable
              key={person.id}
              onPress={() => pick(person.username)}
              accessibilityRole="button"
              accessibilityLabel={`@${person.username} einfügen`}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Avatar uri={person.avatarUrl} username={person.username} size={28} />
              <Text style={[styles.rowText, dark && styles.rowTextDark]} numberOfLines={1}>
                {person.displayName}{" "}
                <Text style={[styles.handle, dark && styles.handleDark]}>@{person.username}</Text>
              </Text>
            </Pressable>
          ))
        : [
            ...(suggestions.fresh !== null
              ? [
                  <Pressable
                    key="fresh"
                    onPress={() => pick(suggestions.fresh ?? "")}
                    accessibilityRole="button"
                    accessibilityLabel={`Neuen Hashtag ${suggestions.fresh} verwenden`}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  >
                    <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
                    <Text style={[styles.rowText, dark && styles.rowTextDark]}>#{suggestions.fresh}</Text>
                    <Text style={styles.count}>neu</Text>
                  </Pressable>,
                ]
              : []),
            ...suggestions.tags.map((tag) => (
              <Pressable
                key={tag.tag}
                onPress={() => pick(tag.tag)}
                accessibilityRole="button"
                accessibilityLabel={`#${tag.tag}, ${tag.useCount} mal verwendet`}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <Ionicons name="pricetag-outline" size={20} color={colors.textSecondary} />
                <Text style={[styles.rowText, dark && styles.rowTextDark]}>#{tag.tag}</Text>
                <Text style={styles.count}>· {tag.useCount}</Text>
              </Pressable>
            )),
          ];

  const list =
    rows.length > 0 ? (
      <View
        style={[
          styles.list,
          dark && styles.listDark,
          suggestionsPlacement === "above" ? styles.above : styles.below,
        ]}
      >
        <ScrollView keyboardShouldPersistTaps="always" nestedScrollEnabled>
          {rows}
        </ScrollView>
      </View>
    ) : null;

  return (
    <View style={[styles.container, containerStyle]}>
      <TextInput
        keyboardAppearance={scheme}
        ref={ref}
        {...inputProps}
        value={value}
        onChangeText={(text) => {
          onChangeText(text);
          setForcedSelection(undefined);
        }}
        selection={forcedSelection}
        onSelectionChange={handleSelection}
      />
      {list}
    </View>
  );
});

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    container: {
      zIndex: 10,
    },
    list: {
      position: "absolute",
      left: 0,
      right: 0,
      maxHeight: 220,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
      zIndex: 20,
    },
    listDark: {
      backgroundColor: onPhoto.panel,
    },
    above: {
      bottom: "100%",
      marginBottom: spacing.xs,
    },
    below: {
      top: "100%",
      marginTop: spacing.xs,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    pressed: {
      backgroundColor: colors.border,
    },
    rowText: {
      flex: 1,
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: "600",
    },
    handle: {
      ...typography.caption,
      fontWeight: "400",
      color: colors.textSecondary,
    },
    handleDark: {
      color: onPhoto.textSecondary,
    },
    rowTextDark: {
      color: onPhoto.text,
    },
    count: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
  }),
);
