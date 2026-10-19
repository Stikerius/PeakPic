/**
 * Database types matching supabase/schema.sql.
 * Hand-written for now; can be replaced by `npx supabase gen types typescript`.
 */

type Timestamp = string;
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
        Row: { id: Uuid; username: string; avatar_path: string | null; created_at: Timestamp };
        Insert: { id: Uuid; username: string; avatar_path?: string | null; created_at?: Timestamp };
        Update: { username?: string; avatar_path?: string | null };
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
        };
        Insert: {
          id?: Uuid;
          user_id: Uuid;
          photo_path: string;
          caption?: string | null;
          workout_date?: string;
          created_at?: Timestamp;
        };
        Update: { caption?: string | null };
        Relationships: [Rel<"posts_user_id_fkey", "user_id", "profiles">];
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
        Row: { id: Uuid; post_id: Uuid; user_id: Uuid; body: string; created_at: Timestamp };
        Insert: { id?: Uuid; post_id: Uuid; user_id: Uuid; body: string; created_at?: Timestamp };
        Update: Record<string, never>;
        Relationships: [
          Rel<"comments_post_id_fkey", "post_id", "posts">,
          Rel<"comments_user_id_fkey", "user_id", "profiles">,
        ];
      };
      follows: {
        Row: { follower_id: Uuid; following_id: Uuid; created_at: Timestamp };
        Insert: { follower_id: Uuid; following_id: Uuid; created_at?: Timestamp };
        Update: Record<string, never>;
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
        };
        Insert: {
          id?: Uuid;
          user_id: Uuid;
          photo_path: string;
          created_at?: Timestamp;
          expires_at?: Timestamp;
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
          created_at: Timestamp;
        };
        Insert: {
          id?: Uuid;
          conversation_id: Uuid;
          sender_id: Uuid;
          body?: string | null;
          post_id?: Uuid | null;
          created_at?: Timestamp;
        };
        Update: Record<string, never>;
        Relationships: [
          Rel<"messages_conversation_id_fkey", "conversation_id", "conversations">,
          Rel<"messages_sender_id_fkey", "sender_id", "profiles">,
          Rel<"messages_post_id_fkey", "post_id", "posts">,
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      username_available: { Args: { name: string }; Returns: boolean };
      get_or_create_direct_conversation: { Args: { other_user: Uuid }; Returns: Uuid };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
