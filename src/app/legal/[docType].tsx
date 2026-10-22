import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { MarkdownView } from "@/components/legal/markdown-view";
import { Divider } from "@/components/ui/divider";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { ListItem } from "@/components/ui/list-item";
import { SectionHeader } from "@/components/ui/section-header";
import { spacing, typography } from "@/constants/theme";
import { formatDate } from "@/lib/format";
import {
  LEGAL_TYPE_LABELS,
  fetchCurrentLegalDocuments,
  fetchLegalDocument,
  fetchLegalVersions,
  type LegalDocument,
  type LegalVersion,
} from "@/lib/legalRepo";
import { markLegalViewed } from "@/lib/legalViewed";
import { makeStyles, useTheme } from "@/lib/theme";
import type { LegalDocType } from "@/types/database";

function isDocType(value: string | undefined): value is LegalDocType {
  return value === "terms" || value === "privacy" || value === "guidelines";
}

/**
 * Reads a legal text: the current version, or an older one (id). Also reachable without an
 * account (from the login screen).
 */
export default function LegalDocumentScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const params = useLocalSearchParams<{ docType: string; id?: string }>();
  const docType = isDocType(params.docType) ? params.docType : null;
  const [doc, setDoc] = useState<LegalDocument | null | undefined>(undefined);
  const [versions, setVersions] = useState<LegalVersion[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (docType === null) return;
    markLegalViewed(docType);
    let active = true;
    const load = params.id !== undefined
      ? fetchLegalDocument(params.id)
      : fetchCurrentLegalDocuments().then((docs) => docs.find((d) => d.docType === docType) ?? null);
    Promise.all([load, fetchLegalVersions(docType)])
      .then(([result, list]) => {
        if (!active) return;
        setDoc(result);
        setVersions(list);
        setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [docType, params.id, attempt]);

  const title = docType !== null ? LEGAL_TYPE_LABELS[docType] : "Rechtstext";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title }} />
      {failed ? (
        <ErrorState onRetry={() => setAttempt((v) => v + 1)} />
      ) : doc === undefined ? (
        <ActivityIndicator color={colors.textSecondary} style={styles.loader} />
      ) : doc === null ? (
        <EmptyState icon="document-text-outline" title="Noch nicht veröffentlicht" message="Dieser Text ist noch nicht verfügbar." />
      ) : (
        <>
          <View style={styles.header}>
            <Text style={styles.title}>{doc.title}</Text>
            <Text style={styles.meta}>
              Version {doc.version} vom {formatDate(doc.publishedAt)}
              {params.id !== undefined ? " · ältere Version (nur lesen)" : ""}
            </Text>
          </View>
          <MarkdownView source={doc.bodyMd} />
        </>
      )}
      {versions.length > 1 && docType !== null && (
        <View style={styles.versions}>
          <SectionHeader title="Alle Versionen" />
          {versions.map((version, index) => (
            <View key={version.id}>
              {index > 0 && <Divider inset={spacing.md} />}
              <ListItem
                title={`Version ${version.version}`}
                subtitle={`${formatDate(version.publishedAt)}${version.status === "published" ? " · aktuell" : ""}`}
                chevron
                onPress={() =>
                  router.setParams(version.status === "published" ? { id: undefined } : { id: version.id })
                }
              />
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      gap: spacing.md,
      padding: spacing.md,
      paddingBottom: spacing.xl,
    },
    loader: {
      marginTop: spacing.xl,
    },
    header: {
      gap: spacing.xs,
    },
    title: {
      ...typography.title,
      color: colors.text,
    },
    meta: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    versions: {
      marginHorizontal: -spacing.md,
    },
  }),
);
