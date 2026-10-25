/**
 * Database types matching supabase/schema.sql.
 * Hand-written for now; can be replaced by `npx supabase gen types typescript`.
 */

type Timestamp = string;
export type Visibility = "everyone" | "followers";
export type FollowRowStatus = "pending" | "accepted";
export type TagPermission = "everyone" | "connections" | "nobody";
export type WorkoutShareStatus = "pending" | "accepted" | "declined";
export type NotificationType =
  | "tag"
  | "workout_tag_request"
  | "workout_tag_accepted"
  | "follow_request"
  | "legal_update"
  | "plan_adopted";
export type LegalDocType = "terms" | "privacy" | "guidelines";
export type LegalConfirmationType = "accept" | "acknowledge";
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type AudienceScope = "stories" | "posts";
export type AccountStatus = "active" | "suspended" | "banned" | "deleting";
export type PlanVisibility = "private" | "followers" | "public";
export type PlanDayType = "training" | "rest";
export type ReportTargetType = "post" | "story" | "comment" | "message" | "profile" | "plan" | "workout";
export type ReportReason =
  | "spam"
  | "harassment"
  | "nudity"
  | "violence"
  | "hate"
  | "copyright"
  | "self_harm"
  | "non_consensual"
  | "other";
export type ReportStatus = "open" | "in_review" | "resolved" | "dismissed";
type Uuid = string;

type Rel<Name extends string, Column extends string, Target extends string> = {
  foreignKeyName: Name;
  columns: [Column];
  isOneToOne: false;
  referencedRelation: Target;
  referencedColumns: ["id"];
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: Uuid;
          username: string;
          display_name: string;
          username_changed_at: Timestamp | null;
          onboarding_done_at: Timestamp | null;
          account_status: AccountStatus;
          suspended_until: Timestamp | null;
          suspension_reason_code: string | null;
          moderation_message: string | null;
          moderation_updated_at: Timestamp | null;
          avatar_path: string | null;
          created_at: Timestamp;
          notifications_seen_at: Timestamp;
          is_private: boolean;
          story_visibility: Visibility;
          post_visibility: Visibility;
          tag_permission: TagPermission;
          tag_notifications: boolean;
          tag_chat_messages: boolean;
          notify_plan_adopted: boolean;
          default_activity_visibility: PlanVisibility;
          training_stats_visibility: PlanVisibility;
        };
        Insert: { id: Uuid; username: string; display_name?: string; avatar_path?: string | null; created_at?: Timestamp };
        Update: {
          username?: string;
          display_name?: string;
          onboarding_done_at?: Timestamp;
          avatar_path?: string | null;
          notifications_seen_at?: Timestamp;
          is_private?: boolean;
          story_visibility?: Visibility;
          post_visibility?: Visibility;
          tag_permission?: TagPermission;
          tag_notifications?: boolean;
          tag_chat_messages?: boolean;
          notify_plan_adopted?: boolean;
          default_activity_visibility?: PlanVisibility;
          training_stats_visibility?: PlanVisibility;
        };
        Relationships: [];
      };
      posts: {
        Row: {
          id: Uuid;
          user_id: Uuid;
          photo_path: string;
          caption: string | null;
          workout_date: string;
          created_at: Timestamp;
          in_feed: boolean;
          is_day_post: boolean;
          show_in_profile: boolean;
          plan_day_id: Uuid | null;
          plan_day_title: string | null;
          plan_day_position: number | null;
          plan_length: number | null;
        };
        Insert: {
          id?: Uuid;
          user_id: Uuid;
          photo_path: string;
          caption?: string | null;
          workout_date?: string;
          created_at?: Timestamp;
          in_feed?: boolean;
          is_day_post?: boolean;
          show_in_profile?: boolean;
          plan_day_id?: Uuid | null;
        };
        Update: {
          caption?: string | null;
          in_feed?: boolean;
          photo_path?: string;
          show_in_profile?: boolean;
          plan_day_id?: Uuid | null;
        };
        Relationships: [Rel<"posts_user_id_fkey", "user_id", "profiles">];
      };
      post_media: {
        Row: {
          id: Uuid;
          post_id: Uuid;
          user_id: Uuid;
          photo_path: string;
          position: number;
          created_at: Timestamp;
          original_path: string | null;
          edits: Json | null;
        };
        Insert: {
          id?: Uuid;
          post_id: Uuid;
          user_id: Uuid;
          photo_path: string;
          position?: number;
          created_at?: Timestamp;
          original_path?: string | null;
          edits?: Json | null;
        };
        Update: { position?: number };
        Relationships: [
          Rel<"post_media_post_id_fkey", "post_id", "posts">,
          Rel<"post_media_user_id_fkey", "user_id", "profiles">,
        ];
      };
      post_tags: {
        Row: { post_id: Uuid; user_id: Uuid; created_at: Timestamp };
        Insert: { post_id: Uuid; user_id: Uuid; created_at?: Timestamp };
        Update: Record<string, never>;
        Relationships: [
          Rel<"post_tags_post_id_fkey", "post_id", "posts">,
          Rel<"post_tags_user_id_fkey", "user_id", "profiles">,
        ];
      };
      post_likes: {
        Row: { post_id: Uuid; user_id: Uuid; created_at: Timestamp };
        Insert: { post_id: Uuid; user_id: Uuid; created_at?: Timestamp };
        Update: Record<string, never>;
        Relationships: [
          Rel<"post_likes_post_id_fkey", "post_id", "posts">,
          Rel<"post_likes_user_id_fkey", "user_id", "profiles">,
        ];
      };
      comments: {
        Row: {
          id: Uuid;
          post_id: Uuid;
          user_id: Uuid;
          body: string;
          created_at: Timestamp;
          parent_comment_id: Uuid | null;
        };
        Insert: {
          id?: Uuid;
          post_id: Uuid;
          user_id: Uuid;
          body: string;
          created_at?: Timestamp;
          parent_comment_id?: Uuid | null;
        };
        Update: Record<string, never>;
        Relationships: [
          Rel<"comments_post_id_fkey", "post_id", "posts">,
          Rel<"comments_user_id_fkey", "user_id", "profiles">,
          Rel<"comments_parent_comment_id_fkey", "parent_comment_id", "comments">,
        ];
      };
      comment_likes: {
        Row: { comment_id: Uuid; user_id: Uuid; created_at: Timestamp };
        Insert: { comment_id: Uuid; user_id: Uuid; created_at?: Timestamp };
        Update: Record<string, never>;
        Relationships: [
          Rel<"comment_likes_comment_id_fkey", "comment_id", "comments">,
          Rel<"comment_likes_user_id_fkey", "user_id", "profiles">,
        ];
      };
      follows: {
        Row: { follower_id: Uuid; following_id: Uuid; created_at: Timestamp; status: FollowRowStatus };
        /** status is set by a database trigger; whatever is sent is ignored. */
        Insert: { follower_id: Uuid; following_id: Uuid; created_at?: Timestamp };
        /** Only the followed person, only pending -> accepted. */
        Update: { status?: "accepted" };
        Relationships: [
          Rel<"follows_follower_id_fkey", "follower_id", "profiles">,
          Rel<"follows_following_id_fkey", "following_id", "profiles">,
        ];
      };
      stories: {
        Row: {
          id: Uuid;
          user_id: Uuid;
          photo_path: string;
          created_at: Timestamp;
          expires_at: Timestamp;
          mentioned_user_ids: Uuid[];
          /** [{ user_id, x, y }] relative to the canvas (0-1). */
          mention_positions: Json;
          canvas_aspect: number | null;
          overlay_text: string | null;
        };
        Insert: {
          id?: Uuid;
          user_id: Uuid;
          photo_path: string;
          created_at?: Timestamp;
          expires_at?: Timestamp;
          mentioned_user_ids?: Uuid[];
          mention_positions?: Json;
          canvas_aspect?: number | null;
          overlay_text?: string | null;
        };
        Update: Record<string, never>;
        Relationships: [Rel<"stories_user_id_fkey", "user_id", "profiles">];
      };
      story_likes: {
        Row: { story_id: Uuid; user_id: Uuid; created_at: Timestamp };
        Insert: { story_id: Uuid; user_id: Uuid; created_at?: Timestamp };
        Update: Record<string, never>;
        Relationships: [
          Rel<"story_likes_story_id_fkey", "story_id", "stories">,
          Rel<"story_likes_user_id_fkey", "user_id", "profiles">,
        ];
      };
      story_views: {
        Row: { story_id: Uuid; user_id: Uuid; viewed_at: Timestamp };
        Insert: { story_id: Uuid; user_id: Uuid; viewed_at?: Timestamp };
        Update: Record<string, never>;
        Relationships: [
          Rel<"story_views_story_id_fkey", "story_id", "stories">,
          Rel<"story_views_user_id_fkey", "user_id", "profiles">,
        ];
      };
      moderation_notices: {
        Row: { id: Uuid; user_id: Uuid; action_id: Uuid | null; kind: string; message: string; created_at: Timestamp; read_at: Timestamp | null };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [Rel<"moderation_notices_user_id_fkey", "user_id", "profiles">];
      };
      user_blocks: {
        Row: { blocker_id: Uuid; blocked_id: Uuid; created_at: Timestamp };
        Insert: { blocker_id: Uuid; blocked_id: Uuid };
        Update: Record<string, never>;
        Relationships: [
          Rel<"user_blocks_blocker_id_fkey", "blocker_id", "profiles">,
          Rel<"user_blocks_blocked_id_fkey", "blocked_id", "profiles">,
        ];
      };
      rest_budgets: {
        Row: { user_id: Uuid; rests_per_cycle: number; cycle_start: string; updated_at: Timestamp };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [Rel<"rest_budgets_user_id_fkey", "user_id", "profiles">];
      };
      rest_day_uses: {
        Row: { user_id: Uuid; day: string; created_at: Timestamp };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [Rel<"rest_day_uses_user_id_fkey", "user_id", "profiles">];
      };
      training_plans: {
        Row: {
          id: Uuid;
          user_id: Uuid;
          name: string;
          /** Replaced by visibility; kept in sync by save_plan. */
          show_in_profile: boolean;
          visibility: PlanVisibility;
          allow_adopt: boolean;
          is_active: boolean;
          adopted_from_plan_id: Uuid | null;
          adopted_from_user_id: Uuid | null;
          adopted_at: Timestamp | null;
          moderation_state: "removed" | "quarantined" | null;
          sequence_changed_at: Timestamp;
          deactivated_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [
          Rel<"training_plans_user_id_fkey", "user_id", "profiles">,
          Rel<"training_plans_adopted_from_user_id_fkey", "adopted_from_user_id", "profiles">,
        ];
      };
      plan_days: {
        Row: {
          id: Uuid;
          plan_id: Uuid;
          position: number;
          day_type: PlanDayType;
          title: string;
          notes: string | null;
          created_at: Timestamp;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [Rel<"plan_days_plan_id_fkey", "plan_id", "training_plans">];
      };
      plan_exercises: {
        Row: {
          id: Uuid;
          plan_day_id: Uuid;
          position: number;
          name: string;
          sets: number;
          reps_min: number | null;
          reps_max: number | null;
          target_seconds: number | null;
          target_weight_kg: number | null;
          notes: string | null;
          created_at: Timestamp;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [Rel<"plan_exercises_plan_day_id_fkey", "plan_day_id", "plan_days">];
      };
      workouts: {
        Row: {
          id: Uuid;
          user_id: Uuid;
          client_id: Uuid;
          plan_id: Uuid | null;
          plan_day_id: Uuid | null;
          plan_day_title: string | null;
          title: string | null;
          note: string | null;
          started_at: Timestamp;
          ended_at: Timestamp;
          active_seconds: number;
          workout_date: string;
          visibility: PlanVisibility;
          share_with_post: boolean;
          post_id: Uuid | null;
          counts_for_streak: boolean;
          not_counting_reason: string | null;
          proof: "workout";
          created_at: Timestamp;
          moderation_state: "removed" | "quarantined" | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [
          Rel<"workouts_user_id_fkey", "user_id", "profiles">,
          Rel<"workouts_post_id_fkey", "post_id", "posts">,
          Rel<"workouts_plan_day_id_fkey", "plan_day_id", "plan_days">,
        ];
      };
      workout_exercises: {
        Row: { id: Uuid; workout_id: Uuid; position: number; name: string; planned_exercise_id: Uuid | null };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [Rel<"workout_exercises_workout_id_fkey", "workout_id", "workouts">];
      };
      workout_sets: {
        Row: {
          id: Uuid;
          workout_exercise_id: Uuid;
          position: number;
          reps: number | null;
          weight_kg: number | string | null;
          seconds: number | null;
          rest_seconds: number | null;
          completed_at: Timestamp | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [Rel<"workout_sets_workout_exercise_id_fkey", "workout_exercise_id", "workout_exercises">];
      };
      planned_rest_uses: {
        Row: { user_id: Uuid; day: string; plan_id: Uuid | null; plan_day_id: Uuid | null; created_at: Timestamp };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      highlights: {
        Row: { id: Uuid; user_id: Uuid; title: string; cover_story_id: Uuid | null; created_at: Timestamp };
        Insert: { id?: Uuid; user_id: Uuid; title: string; cover_story_id?: Uuid | null; created_at?: Timestamp };
        Update: { title?: string; cover_story_id?: Uuid | null };
        Relationships: [
          Rel<"highlights_user_id_fkey", "user_id", "profiles">,
          Rel<"highlights_cover_story_id_fkey", "cover_story_id", "stories">,
        ];
      };
      highlight_items: {
        Row: { highlight_id: Uuid; story_id: Uuid; added_at: Timestamp };
        Insert: { highlight_id: Uuid; story_id: Uuid; added_at?: Timestamp };
        Update: Record<string, never>;
        Relationships: [
          Rel<"highlight_items_highlight_id_fkey", "highlight_id", "highlights">,
          Rel<"highlight_items_story_id_fkey", "story_id", "stories">,
        ];
      };
      audience_restrictions: {
        Row: { owner_id: Uuid; hidden_user_id: Uuid; scope: AudienceScope; created_at: Timestamp };
        Insert: { owner_id: Uuid; hidden_user_id: Uuid; scope: AudienceScope; created_at?: Timestamp };
        Update: Record<string, never>;
        Relationships: [
          Rel<"audience_restrictions_owner_id_fkey", "owner_id", "profiles">,
          Rel<"audience_restrictions_hidden_user_id_fkey", "hidden_user_id", "profiles">,
        ];
      };
      conversations: {
        Row: { id: Uuid; created_by: Uuid; created_at: Timestamp };
        Insert: { id?: Uuid; created_by: Uuid; created_at?: Timestamp };
        Update: Record<string, never>;
        Relationships: [Rel<"conversations_created_by_fkey", "created_by", "profiles">];
      };
      conversation_members: {
        Row: {
          conversation_id: Uuid;
          user_id: Uuid;
          joined_at: Timestamp;
          last_read_at: Timestamp;
        };
        Insert: {
          conversation_id: Uuid;
          user_id: Uuid;
          joined_at?: Timestamp;
          last_read_at?: Timestamp;
        };
        Update: { last_read_at?: Timestamp };
        Relationships: [
          Rel<"conversation_members_conversation_id_fkey", "conversation_id", "conversations">,
          Rel<"conversation_members_user_id_fkey", "user_id", "profiles">,
        ];
      };
      messages: {
        Row: {
          id: Uuid;
          conversation_id: Uuid;
          sender_id: Uuid;
          body: string | null;
          post_id: Uuid | null;
          comment_id: Uuid | null;
          reply_to_id: Uuid | null;
          pinned_at: Timestamp | null;
          pinned_by: Uuid | null;
          /** Server-made: "tag" for "hat dich markiert" cards, "notice" for neutral lines. */
          kind: "tag" | "notice" | null;
          story_id: Uuid | null;
          created_at: Timestamp;
        };
        Insert: {
          id?: Uuid;
          conversation_id: Uuid;
          sender_id: Uuid;
          body?: string | null;
          post_id?: Uuid | null;
          comment_id?: Uuid | null;
          reply_to_id?: Uuid | null;
          created_at?: Timestamp;
        };
        Update: Record<string, never>;
        Relationships: [
          Rel<"messages_conversation_id_fkey", "conversation_id", "conversations">,
          Rel<"messages_sender_id_fkey", "sender_id", "profiles">,
          Rel<"messages_post_id_fkey", "post_id", "posts">,
          Rel<"messages_comment_id_fkey", "comment_id", "comments">,
          Rel<"messages_reply_to_id_fkey", "reply_to_id", "messages">,
        ];
      };
      workout_shares: {
        Row: {
          id: Uuid;
          post_id: Uuid;
          tagged_user_id: Uuid;
          status: WorkoutShareStatus;
          created_at: Timestamp;
          responded_at: Timestamp | null;
        };
        /** status is forced to "pending" by a trigger. */
        Insert: { post_id: Uuid; tagged_user_id: Uuid };
        /** Only the tagged person, only from pending. */
        Update: { status?: "accepted" | "declined" };
        Relationships: [
          Rel<"workout_shares_post_id_fkey", "post_id", "posts">,
          Rel<"workout_shares_tagged_user_id_fkey", "tagged_user_id", "profiles">,
        ];
      };
      post_reposts: {
        Row: { id: Uuid; original_post_id: Uuid; reposter_id: Uuid; caption: string | null; created_at: Timestamp };
        Insert: { original_post_id: Uuid; reposter_id: Uuid; caption?: string | null };
        Update: { caption?: string | null };
        Relationships: [
          Rel<"post_reposts_original_post_id_fkey", "original_post_id", "posts">,
          Rel<"post_reposts_reposter_id_fkey", "reposter_id", "profiles">,
        ];
      };
      hashtags: {
        Row: { id: Uuid; tag: string; use_count: number; created_at: Timestamp };
        /** Maintained by database triggers only. */
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      content_hashtags: {
        Row: {
          hashtag_id: Uuid;
          source: "post" | "comment" | "story";
          source_id: Uuid;
          user_id: Uuid;
          created_at: Timestamp;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [Rel<"content_hashtags_hashtag_id_fkey", "hashtag_id", "hashtags">];
      };
      notifications: {
        Row: {
          id: Uuid;
          user_id: Uuid;
          actor_id: Uuid | null;
          type: NotificationType;
          post_id: Uuid | null;
          story_id: Uuid | null;
          comment_id: Uuid | null;
          workout_share_id: Uuid | null;
          payload: Json;
          read_at: Timestamp | null;
          created_at: Timestamp;
        };
        /** Created only by the database. */
        Insert: Record<string, never>;
        Update: { read_at?: Timestamp };
        Relationships: [
          Rel<"notifications_actor_id_fkey", "actor_id", "profiles">,
          Rel<"notifications_post_id_fkey", "post_id", "posts">,
          Rel<"notifications_story_id_fkey", "story_id", "stories">,
          Rel<"notifications_comment_id_fkey", "comment_id", "comments">,
          Rel<"notifications_workout_share_id_fkey", "workout_share_id", "workout_shares">,
        ];
      };
      message_reactions: {
        Row: {
          message_id: Uuid;
          user_id: Uuid;
          conversation_id: Uuid;
          /** null = reaction removed. */
          emoji: string | null;
          updated_at: Timestamp;
        };
        Insert: {
          message_id: Uuid;
          user_id: Uuid;
          conversation_id: Uuid;
          emoji: string | null;
          updated_at?: Timestamp;
        };
        Update: { emoji?: string | null; updated_at?: Timestamp };
        Relationships: [
          Rel<"message_reactions_message_id_fkey", "message_id", "messages">,
          Rel<"message_reactions_user_id_fkey", "user_id", "profiles">,
          Rel<"message_reactions_conversation_id_fkey", "conversation_id", "conversations">,
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      username_available: { Args: { name: string }; Returns: boolean };
      mark_moderation_notices_read: { Args: Record<string, never>; Returns: undefined };
      conversation_has_block: { Args: { conversation: Uuid }; Returns: boolean };
      get_official_account_id: { Args: Record<string, never>; Returns: Uuid | null };
      get_official_feed_items: { Args: Record<string, never>; Returns: Json };
      mark_item_seen: { Args: { p_item_id: Uuid }; Returns: boolean };
      dismiss_item: { Args: { p_item_id: Uuid }; Returns: boolean };
      get_active_surveys: { Args: Record<string, never>; Returns: Json };
      get_official_profile: { Args: Record<string, never>; Returns: Json | null };
      get_official_profile_items: { Args: { p_tab: "surveys" | "results"; p_before?: Timestamp | null; p_limit?: number }; Returns: Json };
      get_survey: { Args: { p_survey_id: Uuid }; Returns: Json | null };
      get_official_item: { Args: { p_item_id: Uuid }; Returns: Json | null };
      submit_survey_response: { Args: { p_survey_id: Uuid; p_answers: Json }; Returns: Json };
      track_survey_event: { Args: { p_survey_id: Uuid | null; p_event: string }; Returns: boolean };
      get_current_legal_documents: {
        Args: Record<string, never>;
        Returns: {
          id: Uuid;
          doc_type: LegalDocType;
          version: number;
          title: string;
          body_md: string;
          change_summary: string | null;
          confirmation_type: LegalConfirmationType;
          requires_confirmation: boolean;
          blocking: boolean;
          grace_days: number;
          published_at: Timestamp;
          content_hash: string;
        }[];
      };
      get_legal_document_versions: {
        Args: { p_doc_type: LegalDocType };
        Returns: { id: Uuid; version: number; title: string; published_at: Timestamp; status: string }[];
      };
      get_legal_document: {
        Args: { p_id: Uuid };
        Returns: {
          id: Uuid;
          doc_type: LegalDocType;
          version: number;
          title: string;
          body_md: string;
          change_summary: string | null;
          confirmation_type: LegalConfirmationType;
          published_at: Timestamp;
          status: string;
        }[];
      };
      get_my_legal_status: {
        Args: Record<string, never>;
        Returns: {
          document_id: Uuid;
          doc_type: LegalDocType;
          version: number;
          title: string;
          requires_confirmation: boolean;
          confirmation_type: LegalConfirmationType;
          confirmed_at: Timestamp | null;
          last_confirmed_version: number | null;
          last_confirmed_at: Timestamp | null;
          can_postpone: boolean;
        }[];
      };
      confirm_legal_documents: { Args: { p_document_ids: Uuid[]; p_app_version: string }; Returns: number };
      track_events: { Args: { events: Json }; Returns: number };
      get_chat_messages: {
        Args: { p_conversation_id: Uuid; p_before: Timestamp | null; p_limit: number };
        Returns: {
          id: Uuid;
          conversation_id: Uuid;
          sender_id: Uuid;
          body: string | null;
          post_id: Uuid | null;
          comment_id: Uuid | null;
          reply_to_id: Uuid | null;
          pinned_at: Timestamp | null;
          kind: "tag" | "notice" | null;
          story_id: Uuid | null;
          created_at: Timestamp;
          masked: boolean;
        }[];
      };
      clear_chat_for_me: {
        Args: { p_conversation_id: Uuid };
        Returns: undefined;
      };
      get_public_design_config: {
        Args: Record<string, never>;
        Returns: Json;
      };
      get_my_cleared_conversations: {
        Args: Record<string, never>;
        Returns: { conversation_id: Uuid; cleared_at: Timestamp }[];
      };
      get_chat_partner_states: {
        Args: { p_conversation_ids: Uuid[] };
        Returns: { conversation_id: Uuid; state: "left" | "deleted" }[];
      };
      get_my_account_status: {
        Args: Record<string, never>;
        Returns: { status: AccountStatus; suspended_until: Timestamp | null; reason_code: string | null; message: string | null }[];
      };
      get_my_blocked_accounts: {
        Args: Record<string, never>;
        Returns: { id: Uuid; username: string; display_name: string; avatar_path: string | null; blocked_at: Timestamp }[];
      };
      report_content: {
        Args: { p_target_type: ReportTargetType; p_target_id: Uuid; p_reason: ReportReason; p_details: string };
        Returns: Uuid;
      };
      report_message: { Args: { message_id: Uuid; reason: ReportReason; details: string }; Returns: Uuid };
      get_my_reports: {
        Args: Record<string, never>;
        Returns: {
          id: Uuid;
          target_type: ReportTargetType;
          reason: ReportReason;
          status: ReportStatus;
          created_at: Timestamp;
          handled_at: Timestamp | null;
        }[];
      };
      set_rest_budget: { Args: { n: number }; Returns: undefined };
      use_rest_day: { Args: { d: string }; Returns: undefined };
      undo_rest_day: { Args: { d: string }; Returns: undefined };
      rest_days: { Args: { target: Uuid }; Returns: { day: string }[] };
      plan_proofs: {
        Args: Record<string, never>;
        Returns: { day: string; created_at: Timestamp; plan_day_id: Uuid | null; kind: "training" | "rest" }[];
      };
      save_plan: {
        Args: { p_plan_id: Uuid | null; p_name: string; p_visibility: PlanVisibility; p_allow_adopt: boolean; p_days: Json };
        Returns: Uuid;
      };
      activate_plan: { Args: { p_plan_id: Uuid; p_resume?: boolean }; Returns: undefined };
      deactivate_plan: { Args: Record<string, never>; Returns: undefined };
      get_my_plan_round: { Args: Record<string, never>; Returns: Json };
      adjust_plan_round: { Args: { p_ordered_open_ids: Uuid[] }; Returns: undefined };
      skip_plan_round_unit: { Args: { p_day_id: Uuid; p_mode: "end" | "drop" }; Returns: undefined };
      resolve_plan_deviation: {
        Args: { p_deviation_id: Uuid; p_decision: string; p_new_order: string[] | null; p_scope: string | null };
        Returns: undefined;
      };
      reorder_plan_days: { Args: { p_plan_id: Uuid; p_ordered_ids: Uuid[] }; Returns: undefined };
      reorder_plan_exercises: { Args: { p_day_id: Uuid; p_ordered_ids: Uuid[] }; Returns: undefined };
      duplicate_plan: { Args: { p_plan_id: Uuid }; Returns: Uuid };
      delete_plan: { Args: { p_plan_id: Uuid }; Returns: undefined };
      my_exercise_names: { Args: Record<string, never>; Returns: { name: string }[] };
      adopt_plan: { Args: { p_plan_id: Uuid; p_activate: boolean }; Returns: Uuid };
      use_planned_rest_day: { Args: { d: string }; Returns: undefined };
      resolve_usernames: { Args: { names: string[] }; Returns: { username: string; user_id: Uuid }[] };
      get_or_create_direct_conversation: { Args: { other_user: Uuid }; Returns: Uuid };
      set_message_pinned: { Args: { message: Uuid; pinned: boolean }; Returns: undefined };
      follow_counts: { Args: { target: Uuid }; Returns: { followers: number; following: number }[] };
      taggable_user_ids: { Args: { ids: Uuid[]; scope: "posts" | "stories" }; Returns: Uuid[] };
      workout_days: {
        Args: { target: Uuid };
        Returns: { day: string; post_id: Uuid | null; shared_by: Uuid | null; proof: "photo" | "workout"; workout_id: Uuid | null }[];
      };
      save_workout: { Args: { payload: Json }; Returns: { [key: string]: Json } };
      link_workout_post: { Args: { p_workout_id: Uuid; p_post_id: Uuid; p_share: boolean }; Returns: undefined };
      set_workout_visibility: { Args: { p_workout_id: Uuid; p_visibility: PlanVisibility }; Returns: undefined };
      can_view_training_stats: { Args: { target: Uuid }; Returns: boolean };
      purge_my_expired_notifications: { Args: Record<string, never>; Returns: number };
      hide_message_for_me: { Args: { p_message_id: Uuid }; Returns: undefined };
      delete_message_for_everyone: { Args: { p_message_id: Uuid }; Returns: undefined };
      get_training_stats: { Args: { p_user_id: Uuid; p_range: "weeks" | "months" | "year" }; Returns: Json | null };
      get_my_training_stats: { Args: { p_range: "weeks" | "months" | "year" }; Returns: Json | null };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
