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

import { MentionSpots } from "@/components/mention-spots";
import { colors, radius, spacing } from "@/constants/theme";
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
};

/** 4:5 photos, swipeable when there are several, with page dots. */
export function PhotoCarousel({
  photoUrls,
  label,
  recyclingKey,
  onPressPhoto,
  mentions,
  onPressMention,
}: PhotoCarouselProps) {
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
        <Ionicons name="image-outline" size={40} color={colors.textMuted} />
      </View>
    );
  }

  return (
    <View style={styles.photo} onLayout={onLayout}>
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
              onPress={onPressPhoto !== undefined ? () => onPressPhoto(index) : undefined}
              disabled={onPressPhoto === undefined}
              accessibilityRole={onPressPhoto !== undefined ? "imagebutton" : "image"}
              accessibilityHint={onPressPhoto !== undefined ? "Tippen zum Vergrössern" : undefined}
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
            <Ionicons name="copy-outline" size={14} color={colors.text} />
          </View>
          <View style={styles.dots} pointerEvents="none">
            {photoUrls.map((url, index) => (
              <View key={`${index}-${url}`} style={[styles.dot, index === page && styles.dotActive]} />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: "rgba(0, 0, 0, 0.5)",
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
    backgroundColor: "rgba(255, 255, 255, 0.45)",
  },
  dotActive: {
    backgroundColor: colors.text,
  },
});
