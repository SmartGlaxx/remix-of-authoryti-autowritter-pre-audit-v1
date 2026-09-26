export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_override_log: {
        Row: {
          admin_email: string
          admin_user_id: string
          created_at: string
          id: string
          reason: string | null
          target_email: string
          target_user_id: string
        }
        Insert: {
          admin_email: string
          admin_user_id: string
          created_at?: string
          id?: string
          reason?: string | null
          target_email: string
          target_user_id: string
        }
        Update: {
          admin_email?: string
          admin_user_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          target_email?: string
          target_user_id?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          metadata: Json | null
          resource_id: string | null
          resource_type: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          metadata?: Json | null
          resource_id?: string | null
          resource_type: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          resource_id?: string | null
          resource_type?: string
          user_id?: string
        }
        Relationships: []
      }
      books: {
        Row: {
          audience: string
          book_type: string
          concepts: string[] | null
          controls: Json
          cover_url: string | null
          created_at: string
          current_chapter_index: number
          current_subsection_index: number
          entities: string[] | null
          full_text: string
          genre: string | null
          id: string
          outline: Json | null
          pov: string
          status: string
          subtitle: string | null
          theme: string
          title: string
          tonal_anchors: string[] | null
          tone_profile: Json
          total_char_count: number
          updated_at: string
          user_id: string
          word_count: number
        }
        Insert: {
          audience: string
          book_type: string
          concepts?: string[] | null
          controls: Json
          cover_url?: string | null
          created_at?: string
          current_chapter_index?: number
          current_subsection_index?: number
          entities?: string[] | null
          full_text?: string
          genre?: string | null
          id?: string
          outline?: Json | null
          pov: string
          status?: string
          subtitle?: string | null
          theme: string
          title: string
          tonal_anchors?: string[] | null
          tone_profile: Json
          total_char_count?: number
          updated_at?: string
          user_id: string
          word_count?: number
        }
        Update: {
          audience?: string
          book_type?: string
          concepts?: string[] | null
          controls?: Json
          cover_url?: string | null
          created_at?: string
          current_chapter_index?: number
          current_subsection_index?: number
          entities?: string[] | null
          full_text?: string
          genre?: string | null
          id?: string
          outline?: Json | null
          pov?: string
          status?: string
          subtitle?: string | null
          theme?: string
          title?: string
          tonal_anchors?: string[] | null
          tone_profile?: Json
          total_char_count?: number
          updated_at?: string
          user_id?: string
          word_count?: number
        }
        Relationships: []
      }
      canonical_facts: {
        Row: {
          authority: string
          book_id: string
          category: string
          confidence: number
          conflict_status: string
          conflicting_fact_id: string | null
          created_at: string
          id: string
          is_canonical: boolean
          notes: string | null
          predicate: string
          source_chapter_index: number | null
          source_excerpt: string | null
          source_subsection_index: number | null
          source_type: string
          subject: string
          subject_character_id: string | null
          subject_entity_id: string | null
          updated_at: string
          user_id: string
          value: string
        }
        Insert: {
          authority?: string
          book_id: string
          category?: string
          confidence?: number
          conflict_status?: string
          conflicting_fact_id?: string | null
          created_at?: string
          id?: string
          is_canonical?: boolean
          notes?: string | null
          predicate: string
          source_chapter_index?: number | null
          source_excerpt?: string | null
          source_subsection_index?: number | null
          source_type?: string
          subject: string
          subject_character_id?: string | null
          subject_entity_id?: string | null
          updated_at?: string
          user_id: string
          value: string
        }
        Update: {
          authority?: string
          book_id?: string
          category?: string
          confidence?: number
          conflict_status?: string
          conflicting_fact_id?: string | null
          created_at?: string
          id?: string
          is_canonical?: boolean
          notes?: string | null
          predicate?: string
          source_chapter_index?: number | null
          source_excerpt?: string | null
          source_subsection_index?: number | null
          source_type?: string
          subject?: string
          subject_character_id?: string | null
          subject_entity_id?: string | null
          updated_at?: string
          user_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "canonical_facts_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canonical_facts_conflicting_fact_id_fkey"
            columns: ["conflicting_fact_id"]
            isOneToOne: false
            referencedRelation: "canonical_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canonical_facts_subject_character_id_fkey"
            columns: ["subject_character_id"]
            isOneToOne: false
            referencedRelation: "story_characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canonical_facts_subject_entity_id_fkey"
            columns: ["subject_entity_id"]
            isOneToOne: false
            referencedRelation: "story_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      character_states: {
        Row: {
          authority: string
          beliefs: Json
          book_id: string
          chapter_index: number
          character_id: string
          created_at: string
          current_goals: string[]
          current_motivations: string | null
          emotional_state: string | null
          id: string
          inventory: string[]
          is_current: boolean
          key_changes: string | null
          knowledge: string[]
          location_entity_id: string | null
          location_text: string | null
          physical_condition: string | null
          position: number | null
          relationships: Json
          secrets_known: string[]
          subsection_index: number
          superseded_by: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          authority?: string
          beliefs?: Json
          book_id: string
          chapter_index: number
          character_id: string
          created_at?: string
          current_goals?: string[]
          current_motivations?: string | null
          emotional_state?: string | null
          id?: string
          inventory?: string[]
          is_current?: boolean
          key_changes?: string | null
          knowledge?: string[]
          location_entity_id?: string | null
          location_text?: string | null
          physical_condition?: string | null
          position?: number | null
          relationships?: Json
          secrets_known?: string[]
          subsection_index?: number
          superseded_by?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          authority?: string
          beliefs?: Json
          book_id?: string
          chapter_index?: number
          character_id?: string
          created_at?: string
          current_goals?: string[]
          current_motivations?: string | null
          emotional_state?: string | null
          id?: string
          inventory?: string[]
          is_current?: boolean
          key_changes?: string | null
          knowledge?: string[]
          location_entity_id?: string | null
          location_text?: string | null
          physical_condition?: string | null
          position?: number | null
          relationships?: Json
          secrets_known?: string[]
          subsection_index?: number
          superseded_by?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "character_states_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_states_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "story_characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_states_location_entity_id_fkey"
            columns: ["location_entity_id"]
            isOneToOne: false
            referencedRelation: "story_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_states_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "character_states"
            referencedColumns: ["id"]
          },
        ]
      }
      error_logs: {
        Row: {
          context: Json | null
          created_at: string
          function_name: string | null
          id: string
          message: string
          source: string
          stack: string | null
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          function_name?: string | null
          id?: string
          message: string
          source: string
          stack?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          function_name?: string | null
          id?: string
          message?: string
          source?: string
          stack?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      event_participants: {
        Row: {
          book_id: string
          character_id: string
          created_at: string
          event_id: string
          participation_role: string | null
          user_id: string
        }
        Insert: {
          book_id: string
          character_id: string
          created_at?: string
          event_id: string
          participation_role?: string | null
          user_id: string
        }
        Update: {
          book_id?: string
          character_id?: string
          created_at?: string
          event_id?: string
          participation_role?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_participants_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_participants_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "story_characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_participants_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "narrative_events"
            referencedColumns: ["id"]
          },
        ]
      }
      narrative_events: {
        Row: {
          authority: string
          book_id: string
          causes: string[]
          chapter_index: number
          chronological_order: number | null
          consequences: string[]
          created_at: string
          id: string
          information_revealed: string[]
          information_withheld: string[]
          is_canonical: boolean
          location_entity_id: string | null
          location_text: string | null
          position: number | null
          prose_excerpt: string | null
          source_subsection_id: string | null
          subsection_index: number
          summary: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          authority?: string
          book_id: string
          causes?: string[]
          chapter_index: number
          chronological_order?: number | null
          consequences?: string[]
          created_at?: string
          id?: string
          information_revealed?: string[]
          information_withheld?: string[]
          is_canonical?: boolean
          location_entity_id?: string | null
          location_text?: string | null
          position?: number | null
          prose_excerpt?: string | null
          source_subsection_id?: string | null
          subsection_index?: number
          summary: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          authority?: string
          book_id?: string
          causes?: string[]
          chapter_index?: number
          chronological_order?: number | null
          consequences?: string[]
          created_at?: string
          id?: string
          information_revealed?: string[]
          information_withheld?: string[]
          is_canonical?: boolean
          location_entity_id?: string | null
          location_text?: string | null
          position?: number | null
          prose_excerpt?: string | null
          source_subsection_id?: string | null
          subsection_index?: number
          summary?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "narrative_events_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narrative_events_location_entity_id_fkey"
            columns: ["location_entity_id"]
            isOneToOne: false
            referencedRelation: "story_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      plot_thread_characters: {
        Row: {
          book_id: string
          character_id: string
          created_at: string
          thread_id: string
          user_id: string
        }
        Insert: {
          book_id: string
          character_id: string
          created_at?: string
          thread_id: string
          user_id: string
        }
        Update: {
          book_id?: string
          character_id?: string
          created_at?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plot_thread_characters_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plot_thread_characters_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "story_characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plot_thread_characters_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "plot_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      plot_thread_events: {
        Row: {
          book_id: string
          created_at: string
          event_id: string
          relation: string
          thread_id: string
          user_id: string
        }
        Insert: {
          book_id: string
          created_at?: string
          event_id: string
          relation?: string
          thread_id: string
          user_id: string
        }
        Update: {
          book_id?: string
          created_at?: string
          event_id?: string
          relation?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plot_thread_events_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plot_thread_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "narrative_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plot_thread_events_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "plot_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      plot_threads: {
        Row: {
          authority: string
          book_id: string
          clues: string[]
          created_at: string
          description: string | null
          id: string
          importance: string
          introduced_chapter_index: number | null
          introduced_subsection_index: number | null
          required_resolution: string | null
          resolution_event_id: string | null
          resolution_notes: string | null
          resolved_chapter_index: number | null
          setup_promise: string | null
          source_key: string | null
          status: string
          superseded_by: string | null
          title: string
          unresolved_questions: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          authority?: string
          book_id: string
          clues?: string[]
          created_at?: string
          description?: string | null
          id?: string
          importance?: string
          introduced_chapter_index?: number | null
          introduced_subsection_index?: number | null
          required_resolution?: string | null
          resolution_event_id?: string | null
          resolution_notes?: string | null
          resolved_chapter_index?: number | null
          setup_promise?: string | null
          source_key?: string | null
          status?: string
          superseded_by?: string | null
          title: string
          unresolved_questions?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          authority?: string
          book_id?: string
          clues?: string[]
          created_at?: string
          description?: string | null
          id?: string
          importance?: string
          introduced_chapter_index?: number | null
          introduced_subsection_index?: number | null
          required_resolution?: string | null
          resolution_event_id?: string | null
          resolution_notes?: string | null
          resolved_chapter_index?: number | null
          setup_promise?: string | null
          source_key?: string | null
          status?: string
          superseded_by?: string | null
          title?: string
          unresolved_questions?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plot_threads_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plot_threads_resolution_event_id_fkey"
            columns: ["resolution_event_id"]
            isOneToOne: false
            referencedRelation: "narrative_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plot_threads_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "plot_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          completed_first_chapter: boolean
          created_at: string
          credits_limit: number
          credits_reset_at: string
          credits_used: number
          current_period_end: string | null
          daily_words_generated: number
          daily_words_reset_at: string
          full_name: string
          id: string
          last_activity_date: string | null
          onboarding_completed: boolean
          pending_plan: string | null
          pending_plan_at: string | null
          plan: string
          streak_days: number
          streak_start_date: string | null
          stripe_subscription_id: string | null
          testimonial_prompted: boolean
          total_words_written: number
          turbo_cycles_completed: number
          turbo_unlocked: boolean
          turbo_words_capacity: number
          turbo_words_remaining: number
          updated_at: string
        }
        Insert: {
          completed_first_chapter?: boolean
          created_at?: string
          credits_limit?: number
          credits_reset_at?: string
          credits_used?: number
          current_period_end?: string | null
          daily_words_generated?: number
          daily_words_reset_at?: string
          full_name?: string
          id: string
          last_activity_date?: string | null
          onboarding_completed?: boolean
          pending_plan?: string | null
          pending_plan_at?: string | null
          plan?: string
          streak_days?: number
          streak_start_date?: string | null
          stripe_subscription_id?: string | null
          testimonial_prompted?: boolean
          total_words_written?: number
          turbo_cycles_completed?: number
          turbo_unlocked?: boolean
          turbo_words_capacity?: number
          turbo_words_remaining?: number
          updated_at?: string
        }
        Update: {
          completed_first_chapter?: boolean
          created_at?: string
          credits_limit?: number
          credits_reset_at?: string
          credits_used?: number
          current_period_end?: string | null
          daily_words_generated?: number
          daily_words_reset_at?: string
          full_name?: string
          id?: string
          last_activity_date?: string | null
          onboarding_completed?: boolean
          pending_plan?: string | null
          pending_plan_at?: string | null
          plan?: string
          streak_days?: number
          streak_start_date?: string | null
          stripe_subscription_id?: string | null
          testimonial_prompted?: boolean
          total_words_written?: number
          turbo_cycles_completed?: number
          turbo_unlocked?: boolean
          turbo_words_capacity?: number
          turbo_words_remaining?: number
          updated_at?: string
        }
        Relationships: []
      }
      request_logs: {
        Row: {
          created_at: string
          function_name: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          function_name: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          function_name?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      story_characters: {
        Row: {
          aliases: string[]
          book_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          role: string | null
          source_key: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          aliases?: string[]
          book_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          role?: string | null
          source_key?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          aliases?: string[]
          book_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          role?: string | null
          source_key?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_characters_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      story_entities: {
        Row: {
          aliases: string[]
          attributes: Json
          book_id: string
          created_at: string
          description: string | null
          entity_type: string
          first_chapter_index: number | null
          first_subsection_index: number | null
          id: string
          is_active: boolean
          name: string
          source_key: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          aliases?: string[]
          attributes?: Json
          book_id: string
          created_at?: string
          description?: string | null
          entity_type: string
          first_chapter_index?: number | null
          first_subsection_index?: number | null
          id?: string
          is_active?: boolean
          name: string
          source_key?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          aliases?: string[]
          attributes?: Json
          book_id?: string
          created_at?: string
          description?: string | null
          entity_type?: string
          first_chapter_index?: number | null
          first_subsection_index?: number | null
          id?: string
          is_active?: boolean
          name?: string
          source_key?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_entities_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      story_state_snapshots: {
        Row: {
          book_id: string
          chapter_index: number
          created_at: string
          id: string
          narrative_summary: string | null
          scope: string
          state: Json
          subsection_index: number
          timeline_position: number | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          book_id: string
          chapter_index: number
          created_at?: string
          id?: string
          narrative_summary?: string | null
          scope?: string
          state?: Json
          subsection_index?: number
          timeline_position?: number | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          book_id?: string
          chapter_index?: number
          created_at?: string
          id?: string
          narrative_summary?: string | null
          scope?: string
          state?: Json
          subsection_index?: number
          timeline_position?: number | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "story_state_snapshots_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      story_timeline: {
        Row: {
          book_id: string
          chapter_index: number | null
          created_at: string
          duration: string | null
          event_id: string | null
          event_summary: string
          id: string
          is_flashback: boolean
          location_entity_id: string | null
          location_text: string | null
          participant_ids: string[]
          relative_order: number
          story_date: string | null
          story_time: string | null
          subsection_index: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          book_id: string
          chapter_index?: number | null
          created_at?: string
          duration?: string | null
          event_id?: string | null
          event_summary: string
          id?: string
          is_flashback?: boolean
          location_entity_id?: string | null
          location_text?: string | null
          participant_ids?: string[]
          relative_order: number
          story_date?: string | null
          story_time?: string | null
          subsection_index?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          book_id?: string
          chapter_index?: number | null
          created_at?: string
          duration?: string | null
          event_id?: string | null
          event_summary?: string
          id?: string
          is_flashback?: boolean
          location_entity_id?: string | null
          location_text?: string | null
          participant_ids?: string[]
          relative_order?: number
          story_date?: string | null
          story_time?: string | null
          subsection_index?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_timeline_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_timeline_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "narrative_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_timeline_location_entity_id_fkey"
            columns: ["location_entity_id"]
            isOneToOne: false
            referencedRelation: "story_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      turbo_progress: {
        Row: {
          activity_date: string
          created_at: string
          credits_used: number
          id: string
          sessions_count: number
          updated_at: string
          user_id: string
          words_written: number
        }
        Insert: {
          activity_date?: string
          created_at?: string
          credits_used?: number
          id?: string
          sessions_count?: number
          updated_at?: string
          user_id: string
          words_written?: number
        }
        Update: {
          activity_date?: string
          created_at?: string
          credits_used?: number
          id?: string
          sessions_count?: number
          updated_at?: string
          user_id?: string
          words_written?: number
        }
        Relationships: []
      }
      user_feedback: {
        Row: {
          category: string
          created_at: string
          email: string | null
          id: string
          message: string
          rating: number
          reviewed: boolean
          user_id: string
        }
        Insert: {
          category: string
          created_at?: string
          email?: string | null
          id?: string
          message: string
          rating: number
          reviewed?: boolean
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          email?: string | null
          id?: string
          message?: string
          rating?: number
          reviewed?: boolean
          user_id?: string
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          created_at: string | null
          email: string
          id: string
          invited: boolean | null
          source: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          invited?: boolean | null
          source?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          invited?: boolean | null
          source?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_and_deduct_word_credits: {
        Args: {
          _estimated_words: number
          _skip_daily_cap?: boolean
          _user_id: string
        }
        Returns: Json
      }
      check_rate_limit: {
        Args: {
          _function_name: string
          _max_per_day?: number
          _max_per_hour?: number
          _user_id: string
        }
        Returns: boolean
      }
      cleanup_old_request_logs: { Args: never; Returns: undefined }
      mark_first_chapter_completed: {
        Args: { _user_id: string }
        Returns: undefined
      }
      mark_testimonial_prompted: {
        Args: { _user_id: string }
        Returns: undefined
      }
      record_writing_activity: {
        Args: { _credits: number; _user_id: string; _words: number }
        Returns: Json
      }
      story_position: { Args: { _ch: number; _sub: number }; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
