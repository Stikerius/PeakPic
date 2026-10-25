import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { remainingText, type SurveyForAnswering } from "../../../shared/surveys";
import { SwipeToDismiss } from "@/components/swipe-to-dismiss";
import { OfficialBadge } from "@/components/surveys/official-badge";
import { QuestionInput } from "@/components/surveys/question-input";
import { SurveyMediaRow } from "@/components/surveys/survey-media";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { radius, spacing, typography } from "@/constants/theme";
import { emitAppEvent } from "@/lib/events";
import { loadOwnAnswers, saveOwnAnswers, type OwnAnswers } from "@/lib/myAnswers";
import { requireUserId } from "@/lib/session";
import { answersToSend, canContinue, classifySubmitError, formatOwnAnswer, isDirty, progressText, type Answers } from "@/lib/surveyFlow";
import { fetchSurvey, submitSurvey, trackSurveyEvent } from "@/lib/surveyRepo";
import { makeStyles, useTheme } from "@/lib/theme";
import { track } from "@/lib/usage";

/** Where the flow is: the introduction, one question, sending, or a final message. */
type Phase =
  | { kind: "intro" }
  | { kind: "question"; index: number }
  | { kind: "sending" }
  | { kind: "thanks" }
  | { kind: "ended" }
  | { kind: "already" };

/**
 * Taking part: one question per screen with progress, required questions marked, back allowed,
 * sending only after a confirmation, then "Danke". Leaving loses the answers (a confirmation
 * first; swiping down closes only while nothing is entered). If the survey ended meanwhile,
 * nothing is sent; on a network error the answers stay for "Erneut versuchen".
 * Opened again after taking part (e.g. from "Einstellungen → Umfragen"), it shows one's own
 * answers from the copy on this device (the server keeps none linked to the account).
 */
export default function SurveyScreen() {
  const { surveyId } = useLocalSearchParams<{ surveyId: string }>();
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [survey, setSurvey] = useState<SurveyForAnswering | null | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: "intro" });
  const [answers, setAnswers] = useState<Answers>({});
  const [sendError, setSendError] = useState<string | null>(null);
  // Own answers from this device: undefined while loading, null when there are none here.
  const [own, setOwn] = useState<OwnAnswers | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    fetchSurvey(surveyId)
      .then((result) => {
        if (!active) return;
        setSurvey(result);
        setLoadFailed(false);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [surveyId, reloadKey]);

  const answeredBefore = survey?.answered === true;
  useEffect(() => {
    if (!answeredBefore) return;
    let active = true;
    requireUserId()
      .then((userId) => loadOwnAnswers(userId, surveyId))
      .then((result) => {
        if (active) setOwn(result);
      })
      .catch(() => {
        if (active) setOwn(null);
      });
    return () => {
      active = false;
    };
  }, [answeredBefore, surveyId]);

  useEffect(() => {
    track("survey_card_opened");
    trackSurveyEvent(surveyId, "card_opened");
  }, [surveyId]);

  const questions = survey?.questions ?? [];
  const dirty = isDirty(questions, answers);

  function close() {
    if (!dirty || phase.kind === "thanks" || phase.kind === "ended" || phase.kind === "already") {
      router.back();
      return;
    }
    Alert.alert("Umfrage verlassen?", "Deine Eingaben gehen verloren.", [
      { text: "Weiter ausfüllen", style: "cancel" },
      { text: "Verlassen", style: "destructive", onPress: () => router.back() },
    ]);
  }

  function start() {
    trackSurveyEvent(surveyId, "started");
    setPhase({ kind: "question", index: 0 });
  }

  function confirmSend() {
    Alert.alert("Antworten abschicken?", "Danach lassen sie sich nicht mehr ändern. Deine Antworten werden ohne Bezug zu deinem Konto gespeichert.", [
      { text: "Abbrechen", style: "cancel" },
      { text: "Abschicken", onPress: () => void send() },
    ]);
  }

  async function send() {
    if (survey === null || survey === undefined) return;
    const payload = answersToSend(questions, answers, survey.allowText);
    if (payload === null) {
      setSendError("Bitte prüfe deine Antworten.");
      return;
    }
    setSendError(null);
    setPhase({ kind: "sending" });
    try {
      await submitSurvey(survey.surveyId, payload);
      await requireUserId()
        .then((userId) => saveOwnAnswers(userId, survey.surveyId, payload))
        .catch(() => undefined);
      emitAppEvent("surveyAnswered", { surveyId: survey.surveyId });
      setAnswers({});
      setPhase({ kind: "thanks" });
    } catch (error) {
      const failure = classifySubmitError(error);
      if (failure === "ended") setPhase({ kind: "ended" });
      else if (failure === "already") {
        emitAppEvent("surveyAnswered", { surveyId: survey.surveyId });
        setPhase({ kind: "already" });
      } else {
        setPhase({ kind: "question", index: questions.length - 1 });
        setSendError(
          failure === "network"
            ? "Senden hat nicht geklappt. Bitte prüfe deine Verbindung, deine Antworten bleiben erhalten."
            : "Die Antworten konnten nicht angenommen werden. Bitte prüfe sie und versuche es erneut.",
        );
      }
    }
  }

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Schliessen" hitSlop={spacing.sm} style={styles.close}>
        <Ionicons name="close" size={26} color={colors.text} />
      </Pressable>
      {phase.kind === "question" && (
        <View style={styles.progressWrap} accessibilityLabel={progressText(phase.index, questions.length)}>
          <Text style={styles.progressText}>{progressText(phase.index, questions.length)}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${((phase.index + 1) / Math.max(1, questions.length)) * 100}%` }]} />
          </View>
        </View>
      )}
    </View>
  );

  let body: React.ReactNode;
  if (loadFailed) {
    body = <ErrorState fill onRetry={() => setReloadKey((k) => k + 1)} />;
  } else if (survey === undefined) {
    body = (
      <View style={styles.content} accessibilityLabel="Wird geladen" accessibilityRole="progressbar">
        <Skeleton width="70%" height={28} />
        <Skeleton height={80} />
        <Skeleton height={48} />
      </View>
    );
  } else if (survey === null || phase.kind === "ended" || (survey.state !== "active" && phase.kind === "intro")) {
    body = (
      <EmptyState
        fill
        icon="time-outline"
        title="Diese Umfrage ist beendet"
        message={phase.kind === "ended" ? "Sie wurde inzwischen beendet. Deine Antworten wurden nicht gesendet." : "Sie läuft nicht mehr oder ist nicht verfügbar."}
        action={{ label: "Schliessen", onPress: () => router.back() }}
      />
    );
  } else if (survey.answered && phase.kind === "intro") {
    body =
      own === undefined ? null : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]}>
          <OfficialBadge />
          <Text style={styles.title} accessibilityRole="header">
            {survey.title}
          </Text>
          <Text style={styles.meta}>Du hast teilgenommen · {remainingText(survey.endsAt, new Date())}</Text>
          {own === null ? (
            <Text style={styles.body}>
              Deine Antworten sind nur auf dem Gerät gespeichert, auf dem du teilgenommen hast. Auf diesem Gerät sind keine vorhanden.
            </Text>
          ) : (
            <View style={styles.ownList}>
              <Text style={styles.sectionTitle} accessibilityRole="header">
                Deine Antworten
              </Text>
              {questions.map((q, i) => (
                <View key={q.id} style={[styles.ownRow, i > 0 && styles.ownDivider]}>
                  <Text style={styles.meta}>{q.prompt}</Text>
                  <Text style={styles.body}>{formatOwnAnswer(q, own.answers[q.id])}</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={styles.meta}>
            Diese Ansicht kommt aus einer Kopie auf deinem Gerät. Auf dem Server sind deine Antworten ohne Bezug zu deinem Konto gespeichert und lassen
            sich nicht mehr ändern.
          </Text>
        </ScrollView>
      );
  } else if (phase.kind === "already") {
    body = <EmptyState fill icon="checkmark-circle-outline" title="Du hast schon teilgenommen" message="Deine früheren Antworten bleiben gültig." action={{ label: "Schliessen", onPress: () => router.back() }} />;
  } else if (phase.kind === "thanks") {
    body = <EmptyState fill icon="checkmark-circle-outline" title="Danke für deine Teilnahme!" message="Deine Antworten wurden anonym gespeichert." action={{ label: "Schliessen", onPress: () => router.back() }} />;
  } else if (phase.kind === "intro") {
    body = (
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]}>
        <OfficialBadge />
        <Text style={styles.title} accessibilityRole="header">
          {survey.title}
        </Text>
        <Text style={styles.meta}>
          {questions.length === 1 ? "1 Frage" : `${questions.length} Fragen`} · {remainingText(survey.endsAt, new Date())}
        </Text>
        <Text style={styles.body}>{survey.topic}</Text>
        <SurveyMediaRow media={survey.media} />
        <Text style={styles.meta}>Deine Antworten werden ohne Bezug zu deinem Konto gespeichert. Gespeichert wird nur, dass du teilgenommen hast.</Text>
        <Button label="Los geht's" onPress={start} disabled={questions.length === 0} />
      </ScrollView>
    );
  } else {
    const index = phase.kind === "question" ? phase.index : questions.length - 1;
    const question = questions[index];
    const last = index === questions.length - 1;
    const sending = phase.kind === "sending";
    body =
      question === undefined ? null : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.required}>{question.required ? "Pflichtfrage" : "Freiwillig"}</Text>
            <Text style={styles.title} accessibilityRole="header">
              {question.prompt}
            </Text>
            <QuestionInput question={question} value={answers[question.id]} onChange={(value) => setAnswers((a) => ({ ...a, [question.id]: value }))} />
            {sendError !== null && (
              <Text style={styles.error} accessibilityRole="alert">
                {sendError}
              </Text>
            )}
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
            {index > 0 && <Button label="Zurück" variant="secondary" onPress={() => setPhase({ kind: "question", index: index - 1 })} disabled={sending} />}
            <Button
              style={styles.flex}
              label={last ? (sendError !== null ? "Erneut senden" : "Abschicken") : "Weiter"}
              loading={sending}
              disabled={!canContinue(question, answers[question.id], survey.allowText)}
              onPress={() => (last ? confirmSend() : setPhase({ kind: "question", index: index + 1 }))}
            />
          </View>
        </KeyboardAvoidingView>
      );
  }

  return (
    <SwipeToDismiss onDismiss={() => router.back()} enabled={!dirty && phase.kind !== "sending"} style={styles.screen}>
      {header}
      {body}
    </SwipeToDismiss>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      backgroundColor: colors.background,
    },
    flex: {
      flex: 1,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    close: {
      minWidth: 44,
      minHeight: 44,
      justifyContent: "center",
    },
    progressWrap: {
      flex: 1,
      gap: spacing.xs,
    },
    progressText: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    progressTrack: {
      height: 4,
      borderRadius: radius.full,
      backgroundColor: colors.surfaceRaised,
      overflow: "hidden",
    },
    progressFill: {
      height: 4,
      backgroundColor: colors.accent,
    },
    content: {
      padding: spacing.md,
      gap: spacing.md,
    },
    title: {
      ...typography.title,
      color: colors.text,
    },
    body: {
      ...typography.body,
      color: colors.text,
    },
    meta: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    sectionTitle: {
      ...typography.heading,
      color: colors.text,
    },
    ownList: {
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    ownRow: {
      gap: spacing.xs,
      paddingVertical: spacing.sm,
    },
    ownDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    required: {
      ...typography.label,
      color: colors.textSecondary,
    },
    error: {
      ...typography.caption,
      color: colors.danger,
    },
    footer: {
      flexDirection: "row",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      backgroundColor: colors.background,
    },
  }),
);
