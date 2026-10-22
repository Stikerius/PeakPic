import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { MarkdownView } from "@/components/legal/markdown-view";
import { Button } from "@/components/ui/button";
import { radius, spacing, typography } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import {
  LEGAL_TYPE_LABELS,
  confirmLabel,
  confirmLegalDocuments,
  fetchCurrentLegalDocuments,
  type LegalDocument,
  type LegalStatus,
} from "@/lib/legalRepo";
import { makeStyles } from "@/lib/theme";

type PendingLegalListProps = {
  pending: LegalStatus[];
  /** Offer "Später" where the text allows it (not on the suspended screen). */
  allowPostpone: boolean;
  onConfirmed: () => void;
  onPostpone?: (documentId: string) => void;
};

/** Each text separately: what changed, the full text on request, and its own button. */
export function PendingLegalList({ pending, allowPostpone, onConfirmed, onPostpone }: PendingLegalListProps) {
  const styles = useStyles();
  const [documents, setDocuments] = useState<Map<string, LegalDocument>>(new Map());
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchCurrentLegalDocuments()
      .then((docs) => {
        if (active) setDocuments(new Map(docs.map((doc) => [doc.id, doc])));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function confirm(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await confirmLegalDocuments([id]);
      onConfirmed();
    } catch (confirmError) {
      setError(describeError(confirmError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.list}>
      {pending.map((item) => {
        const doc = documents.get(item.documentId);
        const expanded = open.has(item.documentId);
        return (
          <View key={item.documentId} style={styles.card}>
            <Text style={styles.type}>{LEGAL_TYPE_LABELS[item.docType]}</Text>
            <Text style={styles.title} accessibilityRole="header">
              {item.title}
            </Text>
            <Text style={styles.meta}>
              Version {item.version}
              {doc !== undefined ? ` vom ${formatDate(doc.publishedAt)}` : ""}
              {item.lastConfirmedVersion !== null ? ` · zuletzt bestätigt: Version ${item.lastConfirmedVersion}` : ""}
            </Text>
            {doc?.changeSummary !== null && doc?.changeSummary !== undefined && (
              <View style={styles.summary}>
                <Text style={styles.summaryLabel}>Was sich geändert hat</Text>
                <Text style={styles.summaryText}>{doc.changeSummary}</Text>
              </View>
            )}
            <Button
              label={expanded ? "Volltext ausblenden" : "Volltext lesen"}
              variant="ghost"
              size="sm"
              onPress={() =>
                setOpen((current) => {
                  const next = new Set(current);
                  if (next.has(item.documentId)) next.delete(item.documentId);
                  else next.add(item.documentId);
                  return next;
                })
              }
              style={styles.toggle}
            />
            {expanded && doc !== undefined && (
              <View style={styles.body}>
                <MarkdownView source={doc.bodyMd} />
              </View>
            )}
            <Button
              label={confirmLabel(item.confirmationType)}
              onPress={() => void confirm(item.documentId)}
              loading={busyId === item.documentId}
              disabled={busyId !== null && busyId !== item.documentId}
            />
            {allowPostpone && item.canPostpone && onPostpone !== undefined && (
              <Button label="Später" variant="ghost" onPress={() => onPostpone(item.documentId)} />
            )}
          </View>
        );
      })}
      {error !== null && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    list: {
      gap: spacing.md,
    },
    card: {
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    type: {
      ...typography.label,
      color: colors.textSecondary,
    },
    title: {
      ...typography.heading,
      color: colors.text,
    },
    meta: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    summary: {
      gap: spacing.xs,
      padding: spacing.ms,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
    },
    summaryLabel: {
      ...typography.label,
      color: colors.textSecondary,
    },
    summaryText: {
      ...typography.body,
      color: colors.text,
    },
    toggle: {
      alignSelf: "flex-start",
      marginLeft: -spacing.md,
    },
    body: {
      paddingVertical: spacing.sm,
    },
    error: {
      ...typography.caption,
      color: colors.danger,
    },
  }),
);
