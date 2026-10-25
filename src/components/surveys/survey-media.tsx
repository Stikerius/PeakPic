import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import type { SurveyMedia } from "../../../shared/surveys";
import { LogoMark } from "@/components/surveys/logo-mark";
import { Skeleton } from "@/components/ui/skeleton";
import { radius, spacing } from "@/constants/theme";
import { signSurveyMedia } from "@/lib/surveyRepo";
import { makeStyles } from "@/lib/theme";

const IMAGE_HEIGHT = 180;
const LOGO_SIZE = 56;

/**
 * Images and logos of a survey or a results post. Images are signed for a short time when shown;
 * every image and logo carries its alt text for VoiceOver. Nothing is shown when there are none.
 */
export function SurveyMediaRow({ media, compact = false }: { media: readonly SurveyMedia[]; compact?: boolean }) {
  const styles = useStyles();
  const [urls, setUrls] = useState<Map<string, string> | null>(null);
  const images = media.filter((m) => m.kind === "image" && m.path !== null);
  const logos = media.filter((m) => m.kind === "logo");
  const paths = images.map((m) => m.path ?? "").join("|");

  useEffect(() => {
    if (paths === "") return;
    let active = true;
    void signSurveyMedia(paths.split("|")).then((result) => {
      if (active) setUrls(result);
    });
    return () => {
      active = false;
    };
  }, [paths]);

  if (media.length === 0) return null;
  const height = compact ? IMAGE_HEIGHT * 0.75 : IMAGE_HEIGHT;
  return (
    <View style={styles.wrap}>
      {logos.length > 0 && (
        <View style={styles.logos}>
          {logos.map((m, i) => (
            <LogoMark key={i} spec={m.logo} size={LOGO_SIZE} label={m.altText} />
          ))}
        </View>
      )}
      {images.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.images}>
          {images.map((m) => {
            const ratio = m.width !== null && m.height !== null ? m.width / m.height : 4 / 3;
            const url = urls?.get(m.path ?? "") ?? null;
            const width = Math.min(320, Math.max(120, height * ratio));
            return url === null ? (
              <Skeleton key={m.path} width={width} height={height} radius={radius.md} />
            ) : (
              <Image
                key={m.path}
                source={{ uri: url }}
                style={[styles.image, { width, height }]}
                contentFit="cover"
                accessible
                accessibilityRole="image"
                accessibilityLabel={m.altText}
              />
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    wrap: {
      gap: spacing.sm,
    },
    logos: {
      flexDirection: "row",
      gap: spacing.md,
    },
    images: {
      gap: spacing.sm,
    },
    image: {
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
    },
  }),
);
