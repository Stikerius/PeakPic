import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { DoubleTapLike } from "@/components/double-tap-like";
import { MentionSpots } from "@/components/mention-spots";
import { onPhoto, radius, spacing } from "@/constants/theme";
import type { DoubleTapResult } from "@/lib/doubleTapLike";
import { makeStyles, useTheme } from "@/lib/theme";
import type { PhotoMention } from "@/types/social";

/** Posts are edited on a 4:5 canvas. */
const POST_ASPECT = 4 / 5;

type PhotoCarouselProps = {
  photoUrls: string[];
  /** For accessibility labels, e.g. "Workout-Foto von lena". */
  label: string;
  /** Keeps recycled list cells from showing the previous post's photo. */
  recyclingKey?: string;
  /** Tap on a photo, e.g. to open it full screen. */
  onPressPhoto?: (index: number) => void;
  /** @mentions drawn on each photo; tapping one calls onPressMention with the user id. */
  mentions?: PhotoMention[][];
  onPressMention?: (userId: string) => void;
  /**
   * Double tap on a photo likes the post (never unlikes); `liked` is what the screen shows. Also
   * offered to VoiceOver as the action "Gefällt mir" (without the animation).
   */
  like?: { liked: boolean; onDoubleTap: () => DoubleTapResult };
};

/** 4:5 photos, swipeable when there are several, with page dots. */
export function PhotoCarousel({
  photoUrls,
  label,
  recyclingKey,
  onPressPhoto,
  mentions,
  onPressMention,
  like,
}: PhotoCarouselProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);

  function onLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  function onScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (width > 0) setPage(Math.round(event.nativeEvent.contentOffset.x / width));
  }

  if (photoUrls.length === 0) {
    return (
      <View style={[styles.photo, styles.missing]}>
        <Ionicons name="image-outline" size={40} color={colors.textSecondary} />
      </View>
    );
  }

  // With a double tap on the photo, a single tap waits for it (only when it does something).
  const tapInGesture = like !== undefined;
  const content = (
    <>
      {width > 0 && (
        <FlatList
          data={photoUrls}
          keyExtractor={(url, index) => `${index}-${url}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEnabled={photoUrls.length > 1}
          onMomentumScrollEnd={onScrollEnd}
          renderItem={({ item, index }) => (
            <Pressable
              onPress={onPressPhoto !== undefined && !tapInGesture ? () => onPressPhoto(index) : undefined}
              disabled={onPressPhoto === undefined || tapInGesture}
              accessibilityRole={onPressPhoto !== undefined ? "imagebutton" : "image"}
              accessibilityHint={onPressPhoto !== undefined ? "Tippen zum Vergrössern" : undefined}
              accessibilityActions={like !== undefined ? [{ name: "like", label: "Gefällt mir" }] : undefined}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === "like") like?.onDoubleTap();
              }}
            >
              <Image
                source={{ uri: item }}
                style={{ width, height: width * 1.25 }}
                contentFit="cover"
                transition={150}
                recyclingKey={recyclingKey !== undefined ? `${recyclingKey}-${index}` : undefined}
                accessibilityLabel={photoUrls.length > 1 ? `${label}, Bild ${index + 1} von ${photoUrls.length}` : label}
              />
              {onPressMention !== undefined && (
                <MentionSpots
                  spots={mentions?.[index] ?? []}
                  imageAspect={POST_ASPECT}
                  width={width}
                  height={width * 1.25}
                  onPress={onPressMention}
                />
              )}
            </Pressable>
          )}
        />
      )}
      {photoUrls.length > 1 && (
        <>
          <View style={styles.badge} pointerEvents="none">
            <Ionicons name="copy-outline" size={14} color={onPhoto.text} />
          </View>
          <View style={styles.dots} pointerEvents="none">
            {photoUrls.map((url, index) => (
              <View key={`${index}-${url}`} style={[styles.dot, index === page && styles.dotActive]} />
            ))}
          </View>
        </>
      )}
    </>
  );

  if (like === undefined) {
    return (
      <View style={styles.photo} onLayout={onLayout}>
        {content}
      </View>
    );
  }
  return (
    <DoubleTapLike
      liked={like.liked}
      onDoubleTap={like.onDoubleTap}
      onSingleTap={onPressPhoto !== undefined ? () => onPressPhoto(page) : undefined}
      style={styles.photo}
      onLayout={onLayout}
    >
      {content}
    </DoubleTapLike>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    photo: {
      width: "100%",
      aspectRatio: 4 / 5,
      backgroundColor: colors.surface,
    },
    missing: {
      alignItems: "center",
      justifyContent: "center",
    },
    badge: {
      position: "absolute",
      top: spacing.sm,
      right: spacing.sm,
      padding: 6,
      borderRadius: radius.full,
      backgroundColor: onPhoto.scrim,
    },
    dots: {
      position: "absolute",
      bottom: spacing.sm,
      left: 0,
      right: 0,
      flexDirection: "row",
      justifyContent: "center",
      gap: 5,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: radius.full,
      backgroundColor: onPhoto.fillStrong,
    },
    dotActive: {
      backgroundColor: onPhoto.text,
    },
  }),
);
