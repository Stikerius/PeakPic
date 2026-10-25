import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";

import type { OfficialItem } from "../../shared/surveys";
import { describeError } from "@/lib/errors";
import { emitAppEvent, onAppEvent } from "@/lib/events";
import { EMPTY_OFFICIAL_FEED, withAnswered, withSeen, withoutItem, type OfficialFeed } from "@/lib/surveyFeed";
import { dismissItem, fetchOfficialFeed, markItemSeen } from "@/lib/surveyRepo";

/**
 * The official cards of the feed (surveys and results). Loading never blocks the feed: on any
 * error there are simply none. A card counts as seen once it was visible for a second (the
 * FlatList reports that); next time it takes its normal place.
 */
export function useOfficialFeed() {
  const [feed, setFeed] = useState<OfficialFeed>(EMPTY_OFFICIAL_FEED);
  const generation = useRef(0);
  // Seen in this session already (reported once per card).
  const reported = useRef(new Set<string>());

  const reload = useCallback(() => {
    const current = ++generation.current;
    return fetchOfficialFeed().then((next) => {
      if (current === generation.current) setFeed(next);
    });
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    void fetchOfficialFeed().then((next) => {
      if (current === generation.current) setFeed(next);
    });
    const unsubscribers = [
      onAppEvent("surveyAnswered", ({ surveyId }) => setFeed((f) => withAnswered(f, surveyId))),
      onAppEvent("surveyItemDismissed", ({ itemId }) => setFeed((f) => withoutItem(f, itemId))),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  /** Visible for at least a second (it stays where it is until the next load). */
  const markSeen = useCallback((item: OfficialItem) => {
    if (item.seen || reported.current.has(item.itemId)) return;
    reported.current.add(item.itemId);
    void markItemSeen(item.itemId).catch(() => reported.current.delete(item.itemId));
  }, []);

  /** "Später": off the top now (pinned ones stay on top until answered). */
  const later = useCallback((item: OfficialItem) => {
    reported.current.add(item.itemId);
    void markItemSeen(item.itemId).catch(() => undefined);
    setFeed((f) => withSeen(f, item.itemId));
  }, []);

  const dismiss = useCallback((item: OfficialItem) => {
    dismissItem(item.itemId)
      .then(() => emitAppEvent("surveyItemDismissed", { itemId: item.itemId }))
      .catch((error: unknown) => Alert.alert("Ausblenden hat nicht geklappt", describeError(error)));
  }, []);

  return { feed, reload, markSeen, later, dismiss };
}
