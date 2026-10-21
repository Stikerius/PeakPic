import Ionicons from "@expo/vector-icons/Ionicons";
import { createContext, use, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/divider";
import { ListItem } from "@/components/ui/list-item";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { spacing, typography } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { REPORT_DETAILS_MAX_LENGTH, REPORT_REASONS, REPORT_TARGET_LABELS, submitReport } from "@/lib/reportRepo";
import { makeStyles, useTheme } from "@/lib/theme";
import type { ReportReason, ReportTargetType } from "@/types/database";

type ReportRequest = {
  targetType: ReportTargetType;
  targetId: string;
  /** E.g. to resume a paused story. */
  onClose?: () => void;
};

type ReportContextValue = { openReport: (request: ReportRequest) => void };

const ReportContext = createContext<ReportContextValue | null>(null);

/** One report sheet for the whole app; screens open it with useReport().openReport(...). */
export function ReportProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [request, setRequest] = useState<ReportRequest | null>(null);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function openReport(next: ReportRequest) {
    setReason(null);
    setDetails("");
    setError(null);
    setSent(false);
    setRequest(next);
  }

  function close() {
    request?.onClose?.();
    setRequest(null);
  }

  async function send() {
    if (request === null || reason === null) return;
    setSending(true);
    setError(null);
    try {
      await submitReport(request.targetType, request.targetId, reason, details);
      setSent(true);
    } catch (sendError) {
      setError(describeError(sendError));
    } finally {
      setSending(false);
    }
  }

  const title = request !== null ? `${REPORT_TARGET_LABELS[request.targetType]} melden` : "Melden";

  return (
    <ReportContext value={{ openReport }}>
      {children}
      <Sheet visible={request !== null} title={title} onClose={close} heightFraction={0.85}>
        {sent ? (
          <View style={styles.done}>
            <Ionicons name="checkmark-circle-outline" size={40} color={colors.success} />
            <Text style={styles.doneTitle}>Danke, wir prüfen das.</Text>
            <Text style={styles.doneText}>
              Die gemeldete Person erfährt nicht, wer gemeldet hat. Den Stand siehst du in den Einstellungen unter
              „Meine Meldungen“.
            </Text>
            <Button label="Schliessen" variant="secondary" onPress={close} style={styles.doneButton} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.intro}>Warum meldest du das?</Text>
            <View style={styles.reasons} accessibilityRole="radiogroup">
              {REPORT_REASONS.map((option, index) => (
                <View key={option.value}>
                  {index > 0 && <Divider inset={spacing.md} />}
                  <ListItem
                    title={option.label}
                    onPress={() => setReason(option.value)}
                    accessibilityLabel={`${option.label}${reason === option.value ? ", ausgewählt" : ""}`}
                    trailing={
                      reason === option.value ? (
                        <Ionicons name="checkmark" size={20} color={colors.accent} />
                      ) : undefined
                    }
                  />
                </View>
              ))}
            </View>
            <View style={styles.form}>
              <TextField
                label="Details (optional)"
                value={details}
                onChangeText={setDetails}
                placeholder="Was ist passiert?"
                multiline
                maxLength={REPORT_DETAILS_MAX_LENGTH}
                hint={`${details.length}/${REPORT_DETAILS_MAX_LENGTH}`}
              />
              {error !== null && <Text style={styles.error}>{error}</Text>}
              <Button label="Melden" onPress={() => void send()} loading={sending} disabled={reason === null} />
            </View>
          </ScrollView>
        )}
      </Sheet>
    </ReportContext>
  );
}

export function useReport(): ReportContextValue {
  const value = use(ReportContext);
  if (value === null) throw new Error("useReport must be used inside <ReportProvider>");
  return value;
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    content: {
      paddingBottom: spacing.xl,
    },
    intro: {
      ...typography.caption,
      color: colors.textSecondary,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    reasons: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    form: {
      gap: spacing.md,
      padding: spacing.md,
    },
    error: {
      ...typography.caption,
      color: colors.danger,
    },
    done: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.ms,
      padding: spacing.xl,
    },
    doneTitle: {
      ...typography.heading,
      color: colors.text,
      textAlign: "center",
    },
    doneText: {
      ...typography.caption,
      color: colors.textSecondary,
      textAlign: "center",
    },
    doneButton: {
      marginTop: spacing.sm,
      alignSelf: "stretch",
    },
  }),
);
