import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";

import { useOpenProfile } from "@/hooks/use-open-profile";
import { cachedProfile, resolveUsernames } from "@/lib/tagSuggestRepo";
import { parseTaggedText } from "@/lib/taggedText";
import { makeStyles } from "@/lib/theme";

type TaggedTextProps = {
  text: string;
  style?: StyleProp<TextStyle>;
  /** Style for @ and # links (defaults to bold). */
  linkStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

/**
 * Text with tappable @mentions (→ profile, by user id) and #hashtags (→ hashtag page).
 * Can be nested inside another <Text>. Mentions of unknown usernames stay plain text.
 */
export function TaggedText({ text, style, linkStyle, numberOfLines }: TaggedTextProps) {
  const styles = useStyles();
  const openProfile = useOpenProfile();
  const segments = useMemo(() => parseTaggedText(text), [text]);
  const usernames = useMemo(
    () => segments.flatMap((s) => (s.kind === "mention" ? [s.username] : [])),
    [segments],
  );
  // Bumped when usernames got resolved, to re-render with links.
  const [, setResolved] = useState(0);

  useEffect(() => {
    if (usernames.length === 0 || usernames.every((name) => cachedProfile(name) !== undefined)) return;
    let active = true;
    resolveUsernames(usernames)
      .then(() => {
        if (active) setResolved((v) => v + 1);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [usernames.join(",")]);

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {segments.map((segment, index) => {
        if (segment.kind === "text") return segment.value;
        if (segment.kind === "hashtag") {
          return (
            <Text
              key={index}
              style={[styles.link, linkStyle]}
              onPress={() => router.push({ pathname: "/hashtag/[tag]", params: { tag: segment.tag } })}
              accessibilityRole="link"
            >
              {segment.value}
            </Text>
          );
        }
        const profile = cachedProfile(segment.username);
        if (profile === null || profile === undefined) return segment.value;
        return (
          <Text
            key={index}
            style={[styles.link, linkStyle]}
            onPress={() => openProfile(profile.id)}
            accessibilityRole="link"
          >
            {segment.value}
          </Text>
        );
      })}
    </Text>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    link: {
      color: colors.text,
      fontWeight: "700",
    },
  }),
);
