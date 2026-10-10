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
      ai_usage_records: {
        Row: {
          book_id: string | null
          cached_input_tokens: number | null
          created_at: string
          credential_source: string
          error_code: string | null
          estimated_cost_usd: number | null
          id: string
          input_tokens: number | null
          model: string
          output_tokens: number | null
          provider: string
          request_id: string | null
          role: string
          success: boolean
          user_id: string
        }
        Insert: {
          book_id?: string | null
          cached_input_tokens?: number | null
          created_at?: string
          credential_source: string
          error_code?: string | null
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          model: string
          output_tokens?: number | null
          provider: string
          request_id?: string | null
          role: string
          success: boolean
          user_id: string
        }
        Update: {
          book_id?: string | null
          cached_input_tokens?: number | null
          created_at?: string
          credential_source?: string
          error_code?: string | null
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          model?: string
          output_tokens?: number | null
          provider?: string
          request_id?: string | null
          role?: string
          success?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_records_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
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
      book_generation_leases: {
        Row: {
          book_id: string
          chapter_index: number
          created_at: string
          expires_at: string
          fencing_token: number
          heartbeat_at: string
          id: string
          leased_at: string
          status: string
          subsection_index: number
          updated_at: string
          user_id: string
          worker_id: string
        }
        Insert: {
          book_id: string
          chapter_index: number
          created_at?: string
          expires_at: string
          fencing_token?: number
          heartbeat_at?: string
          id?: string
          leased_at?: string
          status?: string
          subsection_index: number
          updated_at?: string
          user_id: string
          worker_id: string
        }
        Update: {
          book_id?: string
          chapter_index?: number
          created_at?: string
          expires_at?: string
          fencing_token?: number
          heartbeat_at?: string
          id?: string
          leased_at?: string
          status?: string
          subsection_index?: number
          updated_at?: string
          user_id?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_generation_leases_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      book_master_plans: {
        Row: {
          approved_at: string | null
          book_id: string
          created_at: string
          genre_adapter_type: string
          genre_data: Json
          id: string
          intended_ending: string
          major_reveals: Json
          master_synopsis: string
          premise: string
          status: string
          supersedes_id: string | null
          twist_alternatives: Json
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          book_id: string
          created_at?: string
          genre_adapter_type?: string
          genre_data?: Json
          id?: string
          intended_ending?: string
          major_reveals?: Json
          master_synopsis?: string
          premise?: string
          status?: string
          supersedes_id?: string | null
          twist_alternatives?: Json
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          approved_at?: string | null
          book_id?: string
          created_at?: string
          genre_adapter_type?: string
          genre_data?: Json
          id?: string
          intended_ending?: string
          major_reveals?: Json
          master_synopsis?: string
          premise?: string
          status?: string
          supersedes_id?: string | null
          twist_alternatives?: Json
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "book_master_plans_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "book_master_plans_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "book_master_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      book_model_configs: {
        Row: {
          book_id: string
          created_at: string
          fallbacks: Json
          id: string
          mode: string
          profile_tier: string | null
          profile_writer: string | null
          role_models: Json
          single_model: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          book_id: string
          created_at?: string
          fallbacks?: Json
          id?: string
          mode?: string
          profile_tier?: string | null
          profile_writer?: string | null
          role_models?: Json
          single_model?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          book_id?: string
          created_at?: string
          fallbacks?: Json
          id?: string
          mode?: string
          profile_tier?: string | null
          profile_writer?: string | null
          role_models?: Json
          single_model?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_model_configs_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: true
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      book_progressive_plans: {
        Row: {
          book_id: string
          chapter_index: number
          content: Json
          created_at: string
          dependencies: Json
          id: string
          master_plan_id: string
          parent_plan_id: string | null
          plan_level: string
          plan_status: string
          subsection_index: number | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          book_id: string
          chapter_index: number
          content?: Json
          created_at?: string
          dependencies?: Json
          id?: string
          master_plan_id: string
          parent_plan_id?: string | null
          plan_level: string
          plan_status?: string
          subsection_index?: number | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          book_id?: string
          chapter_index?: number
          content?: Json
          created_at?: string
          dependencies?: Json
          id?: string
          master_plan_id?: string
          parent_plan_id?: string | null
          plan_level?: string
          plan_status?: string
          subsection_index?: number | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "book_progressive_plans_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "book_progressive_plans_master_plan_id_book_id_fkey"
            columns: ["master_plan_id", "book_id"]
            isOneToOne: false
            referencedRelation: "book_master_plans"
            referencedColumns: ["id", "book_id"]
          },
          {
            foreignKeyName: "book_progressive_plans_parent_fk"
            columns: ["parent_plan_id", "book_id"]
            isOneToOne: false
            referencedRelation: "book_progressive_plans"
            referencedColumns: ["id", "book_id"]
          },
        ]
      }
      book_section_acceptances: {
        Row: {
          attempts: number
          book_id: string
          chapter_index: number
          content_hash: string
          created_at: string
          error: string | null
          extraction_status: string
          id: string
          manuscript_status: string
          master_plan_id: string | null
          section_plan_id: string | null
          subsection_index: number
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          book_id: string
          chapter_index: number
          content_hash: string
          created_at?: string
          error?: string | null
          extraction_status?: string
          id?: string
          manuscript_status?: string
          master_plan_id?: string | null
          section_plan_id?: string | null
          subsection_index: number
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          book_id?: string
          chapter_index?: number
          content_hash?: string
          created_at?: string
          error?: string | null
          extraction_status?: string
          id?: string
          manuscript_status?: string
          master_plan_id?: string | null
          section_plan_id?: string | null
          subsection_index?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_section_acceptances_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "book_section_acceptances_master_plan_id_book_id_fkey"
            columns: ["master_plan_id", "book_id"]
            isOneToOne: false
            referencedRelation: "book_master_plans"
            referencedColumns: ["id", "book_id"]
          },
          {
            foreignKeyName: "book_section_acceptances_section_plan_id_book_id_fkey"
            columns: ["section_plan_id", "book_id"]
            isOneToOne: false
            referencedRelation: "book_progressive_plans"
            referencedColumns: ["id", "book_id"]
          },
        ]
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
          voice_manifest: Json | null
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
          voice_manifest?: Json | null
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
          voice_manifest?: Json | null
          word_count?: number
        }
        Relationships: []
      }
      canon_reconciliation_logs: {
        Row: {
          book_id: string
          canon_reference: Json
          chapter_index: number
          content_hash: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string
          dedup_key: string
          description: string
          discrepancy_type: string
          id: string
          prose_excerpt: string
          rationale: string | null
          replan_required: boolean
          resulting_changes: Json
          severity: string
          subsection_index: number
          updated_at: string
          user_id: string
        }
        Insert: {
          book_id: string
          canon_reference?: Json
          chapter_index: number
          content_hash: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          dedup_key: string
          description: string
          discrepancy_type: string
          id?: string
          prose_excerpt?: string
          rationale?: string | null
          replan_required?: boolean
          resulting_changes?: Json
          severity: string
          subsection_index: number
          updated_at?: string
          user_id: string
        }
        Update: {
          book_id?: string
          canon_reference?: Json
          chapter_index?: number
          content_hash?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          dedup_key?: string
          description?: string
          discrepancy_type?: string
          id?: string
          prose_excerpt?: string
          rationale?: string | null
          replan_required?: boolean
          resulting_changes?: Json
          severity?: string
          subsection_index?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "canon_reconciliation_logs_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
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
          extraction_id: string | null
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
          extraction_id?: string | null
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
          extraction_id?: string | null
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
            foreignKeyName: "canonical_facts_extraction_id_fkey"
            columns: ["extraction_id"]
            isOneToOne: false
            referencedRelation: "narrative_extractions"
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
          extraction_id: string | null
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
          extraction_id?: string | null
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
          extraction_id?: string | null
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
            foreignKeyName: "character_states_extraction_id_fkey"
            columns: ["extraction_id"]
            isOneToOne: false
            referencedRelation: "narrative_extractions"
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
      context_engine_runs: {
        Row: {
          book_id: string
          book_type: string
          cached_input_tokens: number | null
          candidates: number
          chapter_index: number
          context_words: number
          created_at: string
          engine: string
          error: string | null
          estimated_cost_usd: number | null
          fell_back: boolean
          id: string
          included: number
          input_tokens: number | null
          latency_ms: number | null
          model: string | null
          omitted: Json
          output_tokens: number | null
          output_words: number | null
          profile_id: string | null
          prompt_words: number
          subsection_index: number
          user_id: string
        }
        Insert: {
          book_id: string
          book_type: string
          cached_input_tokens?: number | null
          candidates?: number
          chapter_index: number
          context_words?: number
          created_at?: string
          engine: string
          error?: string | null
          estimated_cost_usd?: number | null
          fell_back?: boolean
          id?: string
          included?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          omitted?: Json
          output_tokens?: number | null
          output_words?: number | null
          profile_id?: string | null
          prompt_words?: number
          subsection_index: number
          user_id: string
        }
        Update: {
          book_id?: string
          book_type?: string
          cached_input_tokens?: number | null
          candidates?: number
          chapter_index?: number
          context_words?: number
          created_at?: string
          engine?: string
          error?: string | null
          estimated_cost_usd?: number | null
          fell_back?: boolean
          id?: string
          included?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          omitted?: Json
          output_tokens?: number | null
          output_words?: number | null
          profile_id?: string | null
          prompt_words?: number
          subsection_index?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "context_engine_runs_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      continuity_checks: {
        Row: {
          attempts: Json
          book_id: string
          chapter_index: number
          confidence: number | null
          created_at: string
          error: string | null
          final_hash: string | null
          final_text: string | null
          generation_id: string
          id: string
          issues: Json
          max_severity: string | null
          model_identifier: string | null
          original_hash: string
          original_text: string
          resolution_status: string
          revision_count: number
          status: string
          subsection_id: string | null
          subsection_index: number
          updated_at: string
          user_id: string
          warnings: Json
        }
        Insert: {
          attempts?: Json
          book_id: string
          chapter_index: number
          confidence?: number | null
          created_at?: string
          error?: string | null
          final_hash?: string | null
          final_text?: string | null
          generation_id?: string
          id?: string
          issues?: Json
          max_severity?: string | null
          model_identifier?: string | null
          original_hash: string
          original_text: string
          resolution_status?: string
          revision_count?: number
          status: string
          subsection_id?: string | null
          subsection_index: number
          updated_at?: string
          user_id: string
          warnings?: Json
        }
        Update: {
          attempts?: Json
          book_id?: string
          chapter_index?: number
          confidence?: number | null
          created_at?: string
          error?: string | null
          final_hash?: string | null
          final_text?: string | null
          generation_id?: string
          id?: string
          issues?: Json
          max_severity?: string | null
          model_identifier?: string | null
          original_hash?: string
          original_text?: string
          resolution_status?: string
          revision_count?: number
          status?: string
          subsection_id?: string | null
          subsection_index?: number
          updated_at?: string
          user_id?: string
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "continuity_checks_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
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
      identity_attribute_versions: {
        Row: {
          attribute: string
          authority: string
          book_id: string
          commit_id: string | null
          created_at: string
          effective_position: number
          entity_id: string
          evidence: string
          id: string
          source: string
          source_section_key: string
          user_id: string
          value: string
        }
        Insert: {
          attribute: string
          authority: string
          book_id: string
          commit_id?: string | null
          created_at?: string
          effective_position: number
          entity_id: string
          evidence: string
          id?: string
          source: string
          source_section_key: string
          user_id: string
          value: string
        }
        Update: {
          attribute?: string
          authority?: string
          book_id?: string
          commit_id?: string | null
          created_at?: string
          effective_position?: number
          entity_id?: string
          evidence?: string
          id?: string
          source?: string
          source_section_key?: string
          user_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_attribute_versions_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "identity_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_commits: {
        Row: {
          book_id: string
          content_hash: string
          created_at: string
          extraction_id: string | null
          id: string
          purpose: string
          schema_version: number
          section_id: string
          user_id: string
        }
        Insert: {
          book_id: string
          content_hash: string
          created_at?: string
          extraction_id?: string | null
          id?: string
          purpose: string
          schema_version: number
          section_id: string
          user_id: string
        }
        Update: {
          book_id?: string
          content_hash?: string
          created_at?: string
          extraction_id?: string | null
          id?: string
          purpose?: string
          schema_version?: number
          section_id?: string
          user_id?: string
        }
        Relationships: []
      }
      identity_entities: {
        Row: {
          aliases: string[]
          book_id: string
          created_at: string
          id: string
          introduced_position: number
          kind: string
          name: string
          user_id: string
        }
        Insert: {
          aliases?: string[]
          book_id: string
          created_at?: string
          id?: string
          introduced_position?: number
          kind: string
          name: string
          user_id: string
        }
        Update: {
          aliases?: string[]
          book_id?: string
          created_at?: string
          id?: string
          introduced_position?: number
          kind?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      manuscript_audit_findings: {
        Row: {
          audit_id: string
          auto_fixable: boolean
          book_id: string
          category: string
          concise_description: string
          confidence: number
          contradicting_evidence: string | null
          contradicting_location: Json | null
          created_at: string
          dedup_key: string
          evidence_excerpt: string | null
          evidence_location: Json | null
          explanation: string | null
          id: string
          related_character_ids: string[]
          related_continuity_check_ids: string[]
          related_event_ids: string[]
          related_fact_ids: string[]
          related_plot_thread_ids: string[]
          severity: string
          status: string
          suggested_action: string | null
          title: string
          updated_at: string
          user_canon_protected: boolean
          user_id: string
          user_notes: string | null
          verification: string
        }
        Insert: {
          audit_id: string
          auto_fixable?: boolean
          book_id: string
          category: string
          concise_description?: string
          confidence?: number
          contradicting_evidence?: string | null
          contradicting_location?: Json | null
          created_at?: string
          dedup_key: string
          evidence_excerpt?: string | null
          evidence_location?: Json | null
          explanation?: string | null
          id?: string
          related_character_ids?: string[]
          related_continuity_check_ids?: string[]
          related_event_ids?: string[]
          related_fact_ids?: string[]
          related_plot_thread_ids?: string[]
          severity: string
          status?: string
          suggested_action?: string | null
          title: string
          updated_at?: string
          user_canon_protected?: boolean
          user_id: string
          user_notes?: string | null
          verification?: string
        }
        Update: {
          audit_id?: string
          auto_fixable?: boolean
          book_id?: string
          category?: string
          concise_description?: string
          confidence?: number
          contradicting_evidence?: string | null
          contradicting_location?: Json | null
          created_at?: string
          dedup_key?: string
          evidence_excerpt?: string | null
          evidence_location?: Json | null
          explanation?: string | null
          id?: string
          related_character_ids?: string[]
          related_continuity_check_ids?: string[]
          related_event_ids?: string[]
          related_fact_ids?: string[]
          related_plot_thread_ids?: string[]
          severity?: string
          status?: string
          suggested_action?: string | null
          title?: string
          updated_at?: string
          user_canon_protected?: boolean
          user_id?: string
          user_notes?: string | null
          verification?: string
        }
        Relationships: [
          {
            foreignKeyName: "manuscript_audit_findings_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "manuscript_audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manuscript_audit_findings_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      manuscript_audits: {
        Row: {
          book_id: string
          cache_key: string
          chapter_count: number
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          manuscript_hash: string
          metadata: Json
          model_identifier: string | null
          narrative_state_version: string
          outline_hash: string
          section_count: number
          stage_progress: Json
          status: string
          summary: Json
          updated_at: string
          user_id: string
          word_count: number
        }
        Insert: {
          book_id: string
          cache_key: string
          chapter_count?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          manuscript_hash: string
          metadata?: Json
          model_identifier?: string | null
          narrative_state_version: string
          outline_hash: string
          section_count?: number
          stage_progress?: Json
          status?: string
          summary?: Json
          updated_at?: string
          user_id: string
          word_count?: number
        }
        Update: {
          book_id?: string
          cache_key?: string
          chapter_count?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          manuscript_hash?: string
          metadata?: Json
          model_identifier?: string | null
          narrative_state_version?: string
          outline_hash?: string
          section_count?: number
          stage_progress?: Json
          status?: string
          summary?: Json
          updated_at?: string
          user_id?: string
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "manuscript_audits_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
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
          extraction_id: string | null
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
          extraction_id?: string | null
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
          extraction_id?: string | null
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
            foreignKeyName: "narrative_events_extraction_id_fkey"
            columns: ["extraction_id"]
            isOneToOne: false
            referencedRelation: "narrative_extractions"
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
      narrative_exact_anchors: {
        Row: {
          anchor_key: string
          anchor_type: string
          book_id: string
          context_hint: string
          created_at: string
          effective_chapter_index: number
          exact_text: string
          id: string
          is_active: boolean
          match_mode: string
          retrieval_tags: string[]
          source_ref: Json
          source_type: string
          supersedes_id: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          anchor_key: string
          anchor_type: string
          book_id: string
          context_hint?: string
          created_at?: string
          effective_chapter_index?: number
          exact_text: string
          id?: string
          is_active?: boolean
          match_mode?: string
          retrieval_tags?: string[]
          source_ref?: Json
          source_type: string
          supersedes_id?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          anchor_key?: string
          anchor_type?: string
          book_id?: string
          context_hint?: string
          created_at?: string
          effective_chapter_index?: number
          exact_text?: string
          id?: string
          is_active?: boolean
          match_mode?: string
          retrieval_tags?: string[]
          source_ref?: Json
          source_type?: string
          supersedes_id?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "narrative_exact_anchors_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narrative_exact_anchors_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "narrative_exact_anchors"
            referencedColumns: ["id"]
          },
        ]
      }
      narrative_extractions: {
        Row: {
          applied: Json
          attempts: number
          book_id: string
          chapter_index: number
          content_hash: string
          created_at: string
          error: string | null
          id: string
          model_identifier: string | null
          status: string
          subsection_id: string | null
          subsection_index: number
          updated_at: string
          user_id: string
        }
        Insert: {
          applied?: Json
          attempts?: number
          book_id: string
          chapter_index: number
          content_hash: string
          created_at?: string
          error?: string | null
          id?: string
          model_identifier?: string | null
          status?: string
          subsection_id?: string | null
          subsection_index: number
          updated_at?: string
          user_id: string
        }
        Update: {
          applied?: Json
          attempts?: number
          book_id?: string
          chapter_index?: number
          content_hash?: string
          created_at?: string
          error?: string | null
          id?: string
          model_identifier?: string | null
          status?: string
          subsection_id?: string | null
          subsection_index?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "narrative_extractions_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
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
          extraction_id: string | null
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
          extraction_id?: string | null
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
          extraction_id?: string | null
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
            foreignKeyName: "plot_threads_extraction_id_fkey"
            columns: ["extraction_id"]
            isOneToOne: false
            referencedRelation: "narrative_extractions"
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
      provider_pricing_cache: {
        Row: {
          cache_write_price_per_m: number | null
          cached_input_price_per_m: number | null
          fetched_at: string
          input_price_per_m: number | null
          model_key: string
          output_price_per_m: number | null
          provider: string
          source: string
        }
        Insert: {
          cache_write_price_per_m?: number | null
          cached_input_price_per_m?: number | null
          fetched_at?: string
          input_price_per_m?: number | null
          model_key: string
          output_price_per_m?: number | null
          provider: string
          source: string
        }
        Update: {
          cache_write_price_per_m?: number | null
          cached_input_price_per_m?: number | null
          fetched_at?: string
          input_price_per_m?: number | null
          model_key?: string
          output_price_per_m?: number | null
          provider?: string
          source?: string
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
      saved_book_ideas: {
        Row: {
          audience: string
          book_type: string
          created_at: string
          description: string
          details: Json | null
          genre: string
          id: string
          subtitle: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          audience?: string
          book_type: string
          created_at?: string
          description?: string
          details?: Json | null
          genre?: string
          id?: string
          subtitle?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          audience?: string
          book_type?: string
          created_at?: string
          description?: string
          details?: Json | null
          genre?: string
          id?: string
          subtitle?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      story_characters: {
        Row: {
          aliases: string[]
          book_id: string
          created_at: string
          extraction_id: string | null
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
          extraction_id?: string | null
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
          extraction_id?: string | null
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
          {
            foreignKeyName: "story_characters_extraction_id_fkey"
            columns: ["extraction_id"]
            isOneToOne: false
            referencedRelation: "narrative_extractions"
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
          extraction_id: string | null
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
          extraction_id?: string | null
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
          extraction_id?: string | null
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
            foreignKeyName: "story_timeline_extraction_id_fkey"
            columns: ["extraction_id"]
            isOneToOne: false
            referencedRelation: "narrative_extractions"
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
      user_provider_keys: {
        Row: {
          ciphertext: string
          created_at: string
          id: string
          iv: string
          last_tested_at: string | null
          last4: string
          prefix: string | null
          provider: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ciphertext: string
          created_at?: string
          id?: string
          iv: string
          last_tested_at?: string | null
          last4: string
          prefix?: string | null
          provider: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ciphertext?: string
          created_at?: string
          id?: string
          iv?: string
          last_tested_at?: string | null
          last4?: string
          prefix?: string | null
          provider?: string
          status?: string
          updated_at?: string
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
      acquire_generation_lease: {
        Args: {
          p_book_id: string
          p_chapter: number
          p_sub: number
          p_ttl_seconds?: number
          p_user_id: string
          p_worker: string
        }
        Returns: Json
      }
      assert_generation_fence: {
        Args: {
          p_book_id: string
          p_chapter: number
          p_sub: number
          p_token: number
          p_worker: string
        }
        Returns: undefined
      }
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
      commit_identity_batch: {
        Args: {
          p_book_id: string
          p_changes: Json
          p_content_hash: string
          p_extraction_id: string
          p_purpose: string
          p_schema_version: number
          p_section_id: string
          p_user_id: string
        }
        Returns: Json
      }
      decide_canon_reconciliation: {
        Args: {
          p_decision: string
          p_log_id: string
          p_rationale: string
          p_replan?: boolean
          p_resulting_changes?: Json
        }
        Returns: Json
      }
      mark_first_chapter_completed: {
        Args: { _user_id: string }
        Returns: undefined
      }
      mark_testimonial_prompted: {
        Args: { _user_id: string }
        Returns: undefined
      }
      record_canon_discrepancy: {
        Args: {
          p_book_id: string
          p_canon_ref: Json
          p_chapter: number
          p_content_hash: string
          p_dedup_key: string
          p_description: string
          p_excerpt: string
          p_severity: string
          p_sub: number
          p_type: string
          p_user_id: string
        }
        Returns: Json
      }
      record_writing_activity: {
        Args: { _credits: number; _user_id: string; _words: number }
        Returns: Json
      }
      release_generation_lease: {
        Args: { p_lease_id: string; p_token: number; p_worker: string }
        Returns: boolean
      }
      renew_generation_lease: {
        Args: {
          p_lease_id: string
          p_token: number
          p_ttl_seconds?: number
          p_worker: string
        }
        Returns: Json
      }
      story_position: { Args: { _ch: number; _sub: number }; Returns: number }
      upsert_exact_anchor: {
        Args: {
          p_book_id: string
          p_chapter: number
          p_context?: string
          p_key: string
          p_match: string
          p_source_ref: Json
          p_source_type: string
          p_tags?: string[]
          p_text: string
          p_type: string
          p_user_id: string
        }
        Returns: Json
      }
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
