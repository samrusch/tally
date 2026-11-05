/**
 * Database types for supabase/schema.sql, in the same shape the Supabase CLI generates.
 * The Nuxt Supabase module picks this file up automatically and uses it to type
 * `useSupabaseClient()`. To regenerate after changing the schema:
 *
 *   npx supabase gen types typescript --project-id <your-project-ref> > app/types/database.types.ts
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          apr: number | null
          archived: boolean
          created_at: string
          id: string
          identifier: string | null
          institution: string | null
          linked_account_id: string | null
          min_payment: number | null
          name: string
          type: string
          created_by: string | null
          household_id: string
        }
        Insert: {
          apr?: number | null
          archived?: boolean
          created_at?: string
          id?: string
          identifier?: string | null
          institution?: string | null
          linked_account_id?: string | null
          min_payment?: number | null
          name: string
          type: string
          created_by?: string | null
          household_id: string
        }
        Update: {
          apr?: number | null
          archived?: boolean
          created_at?: string
          id?: string
          identifier?: string | null
          institution?: string | null
          linked_account_id?: string | null
          min_payment?: number | null
          name?: string
          type?: string
          created_by?: string | null
          household_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'accounts_linked_account_id_fkey'
            columns: ['linked_account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
        ]
      }
      balance_entries: {
        Row: {
          account_id: string
          balance: number
          contribution: number | null
          created_at: string
          entry_date: string
          id: string
          mileage: number | null
          note: string | null
          source: string | null
          created_by: string | null
        }
        Insert: {
          account_id: string
          balance: number
          contribution?: number | null
          created_at?: string
          entry_date?: string
          id?: string
          mileage?: number | null
          note?: string | null
          source?: string | null
          created_by?: string | null
        }
        Update: {
          account_id?: string
          balance?: number
          contribution?: number | null
          created_at?: string
          entry_date?: string
          id?: string
          mileage?: number | null
          note?: string | null
          source?: string | null
          created_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'balance_entries_account_id_fkey'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
        ]
      }
      households: {
        Row: { id: string; name: string; created_by: string | null; created_at: string }
        Insert: { id?: string; name?: string; created_by?: string | null; created_at?: string }
        Update: { name?: string }
        Relationships: []
      }
      household_members: {
        Row: { household_id: string; user_id: string; role: string; email: string | null; created_at: string }
        Insert: { household_id: string; user_id: string; role: string; email?: string | null; created_at?: string }
        Update: { role?: string }
        Relationships: []
      }
      household_invites: {
        Row: { id: string; household_id: string; email: string; role: string; invited_by: string | null; created_at: string }
        Insert: { id?: string; household_id: string; email: string; role: string; invited_by?: string | null; created_at?: string }
        Update: { id?: string }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      accept_invites: { Args: Record<PropertyKey, never>; Returns: number }
      invite_member: { Args: { h: string; mail: string; member_role: string }; Returns: string }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
