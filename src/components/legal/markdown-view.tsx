import { StyleSheet, Text, View } from "react-native";

import { radius, spacing, typography } from "@/constants/theme";
import { parseMarkdown, type InlineSpan } from "@/lib/markdown";
import { makeStyles } from "@/lib/theme";

function Spans({ spans }: { spans: InlineSpan[] }) {
  const styles = useStyles();
  return (
    <>
      {spans.map((span, index) => (
        <Text key={index} style={span.bold ? styles.bold : undefined}>
          {span.text}
        </Text>
      ))}
    </>
  );
}

/** Renders the legal texts (see lib/markdown.ts). Plain text only, nothing is interpreted as HTML. */
export function MarkdownView({ source }: { source: string }) {
  const styles = useStyles();
  const blocks = parseMarkdown(source);
  return (
    <View style={styles.container}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading":
            return (
              <Text
                key={index}
                style={block.level === 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3}
                accessibilityRole="header"
              >
                <Spans spans={block.spans} />
              </Text>
            );
          case "paragraph":
            return (
              <Text key={index} style={styles.paragraph}>
                <Spans spans={block.spans} />
              </Text>
            );
          case "quote":
            return (
              <View key={index} style={styles.quote}>
                <Text style={styles.paragraph}>
                  <Spans spans={block.spans} />
                </Text>
              </View>
            );
          case "rule":
            return <View key={index} style={styles.rule} />;
          case "bullet":
          case "numbered":
            return (
              <View key={index} style={styles.list}>
                {block.items.map((item, itemIndex) => (
                  <View key={itemIndex} style={styles.item}>
                    <Text style={styles.marker}>{block.kind === "bullet" ? "•" : `${itemIndex + 1}.`}</Text>
                    <Text style={styles.itemText}>
                      <Spans spans={item} />
                    </Text>
                  </View>
                ))}
              </View>
            );
        }
      })}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    container: {
      gap: spacing.ms,
    },
    h1: {
      ...typography.heading,
      color: colors.text,
      marginTop: spacing.sm,
    },
    h2: {
      ...typography.bodyStrong,
      color: colors.text,
      marginTop: spacing.sm,
    },
    h3: {
      ...typography.body,
      fontWeight: "600",
      color: colors.text,
    },
    paragraph: {
      ...typography.body,
      color: colors.text,
    },
    bold: {
      fontWeight: "600",
    },
    quote: {
      paddingHorizontal: spacing.ms,
      paddingVertical: spacing.sm,
      borderLeftWidth: 3,
      borderLeftColor: colors.border,
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
    },
    rule: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
    },
    list: {
      gap: spacing.xs,
    },
    item: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    marker: {
      ...typography.body,
      color: colors.textSecondary,
      minWidth: 18,
    },
    itemText: {
      ...typography.body,
      flex: 1,
      color: colors.text,
    },
  }),
);
