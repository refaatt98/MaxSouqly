// Generated from the migrations in supabase/migrations (same shape as `supabase gen types typescript`).
// Regenerate with: npx supabase gen types typescript --local > src/types/database.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: { PostgrestVersion: "12" };
  public: {
    Tables: {
      attendance: {
        Row: {
          id: string;
          employee_id: string;
          clock_in: string;
          clock_out: string | null;
          notes: string;
          created_at: string;
          updated_at: string;
          absent: boolean;
        };
        Insert: {
          id?: string;
          employee_id: string;
          clock_in?: string;
          clock_out?: string | null;
          notes?: string;
          created_at?: string;
          updated_at?: string;
          absent?: boolean;
        };
        Update: {
          id?: string;
          employee_id?: string;
          clock_in?: string;
          clock_out?: string | null;
          notes?: string;
          created_at?: string;
          updated_at?: string;
          absent?: boolean;
        };
        Relationships: [
          { foreignKeyName: "attendance_employee_id_fkey"; columns: ["employee_id"]; isOneToOne: false; referencedRelation: "employees_meta"; referencedColumns: ["id"] },
        ];
      };
      audit_log: {
        Row: {
          id: string;
          user_id: string | null;
          action: string;
          entity: string;
          entity_id: string | null;
          details: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          action: string;
          entity: string;
          entity_id?: string | null;
          details?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          action?: string;
          entity?: string;
          entity_id?: string | null;
          details?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "audit_log_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      cash_shifts: {
        Row: {
          id: string;
          cashier_id: string;
          opening_float: number;
          cash_sales: number;
          card_sales: number;
          expected_cash: number | null;
          counted_cash: number | null;
          notes: string;
          opened_at: string;
          closed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          cashier_id: string;
          opening_float?: number;
          cash_sales?: number;
          card_sales?: number;
          expected_cash?: number | null;
          counted_cash?: number | null;
          notes?: string;
          opened_at?: string;
          closed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          cashier_id?: string;
          opening_float?: number;
          cash_sales?: number;
          card_sales?: number;
          expected_cash?: number | null;
          counted_cash?: number | null;
          notes?: string;
          opened_at?: string;
          closed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "cash_shifts_cashier_id_fkey"; columns: ["cashier_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      categories: {
        Row: {
          id: string;
          name_ar: string;
          name_he: string;
          icon: string;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          image_url: string | null;
          printer_id: string | null;
        };
        Insert: {
          id?: string;
          name_ar: string;
          name_he?: string;
          icon?: string;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          image_url?: string | null;
          printer_id?: string | null;
        };
        Update: {
          id?: string;
          name_ar?: string;
          name_he?: string;
          icon?: string;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          image_url?: string | null;
          printer_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: "categories_printer_id_fkey"; columns: ["printer_id"]; isOneToOne: false; referencedRelation: "printers"; referencedColumns: ["id"] },
        ];
      };
      customers: {
        Row: {
          id: string;
          name: string;
          phone: string;
          address: string;
          notes: string;
          orders_count: number;
          total_spent: number;
          last_order_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name?: string;
          phone: string;
          address?: string;
          notes?: string;
          orders_count?: number;
          total_spent?: number;
          last_order_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          phone?: string;
          address?: string;
          notes?: string;
          orders_count?: number;
          total_spent?: number;
          last_order_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
        ];
      };
      employees_meta: {
        Row: {
          id: string;
          profile_id: string | null;
          full_name: string;
          position: string;
          phone: string;
          avatar_url: string | null;
          salary_type: Database["public"]["Enums"]["salary_type"];
          salary_amount: number;
          hire_date: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          profile_id?: string | null;
          full_name: string;
          position?: string;
          phone?: string;
          avatar_url?: string | null;
          salary_type?: Database["public"]["Enums"]["salary_type"];
          salary_amount?: number;
          hire_date?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string | null;
          full_name?: string;
          position?: string;
          phone?: string;
          avatar_url?: string | null;
          salary_type?: Database["public"]["Enums"]["salary_type"];
          salary_amount?: number;
          hire_date?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "employees_meta_profile_id_fkey"; columns: ["profile_id"]; isOneToOne: true; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      expenses: {
        Row: {
          id: string;
          category: Database["public"]["Enums"]["expense_category"];
          amount: number;
          note: string;
          receipt_url: string | null;
          expense_date: string;
          user_id: string | null;
          created_at: string;
          updated_at: string;
          payroll_id: string | null;
        };
        Insert: {
          id?: string;
          category: Database["public"]["Enums"]["expense_category"];
          amount: number;
          note?: string;
          receipt_url?: string | null;
          expense_date?: string;
          user_id?: string | null;
          created_at?: string;
          updated_at?: string;
          payroll_id?: string | null;
        };
        Update: {
          id?: string;
          category?: Database["public"]["Enums"]["expense_category"];
          amount?: number;
          note?: string;
          receipt_url?: string | null;
          expense_date?: string;
          user_id?: string | null;
          created_at?: string;
          updated_at?: string;
          payroll_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: "expenses_payroll_id_fkey"; columns: ["payroll_id"]; isOneToOne: false; referencedRelation: "payroll"; referencedColumns: ["id"] },
          { foreignKeyName: "expenses_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      ingredients: {
        Row: {
          id: string;
          name_ar: string;
          name_he: string;
          unit: Database["public"]["Enums"]["unit_type"];
          quantity: number;
          min_quantity: number;
          cost_per_unit: number;
          image_url: string | null;
          supplier_id: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name_ar: string;
          name_he?: string;
          unit: Database["public"]["Enums"]["unit_type"];
          quantity?: number;
          min_quantity?: number;
          cost_per_unit?: number;
          image_url?: string | null;
          supplier_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name_ar?: string;
          name_he?: string;
          unit?: Database["public"]["Enums"]["unit_type"];
          quantity?: number;
          min_quantity?: number;
          cost_per_unit?: number;
          image_url?: string | null;
          supplier_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "ingredients_supplier_id_fkey"; columns: ["supplier_id"]; isOneToOne: false; referencedRelation: "suppliers"; referencedColumns: ["id"] },
        ];
      };
      menu_item_options: {
        Row: {
          id: string;
          menu_item_id: string;
          name_ar: string;
          name_he: string;
          price: number;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          kind: string;
          max_qty: number;
        };
        Insert: {
          id?: string;
          menu_item_id: string;
          name_ar: string;
          name_he?: string;
          price?: number;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          kind?: string;
          max_qty?: number;
        };
        Update: {
          id?: string;
          menu_item_id?: string;
          name_ar?: string;
          name_he?: string;
          price?: number;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          kind?: string;
          max_qty?: number;
        };
        Relationships: [
          { foreignKeyName: "menu_item_options_menu_item_id_fkey"; columns: ["menu_item_id"]; isOneToOne: false; referencedRelation: "menu_items"; referencedColumns: ["id"] },
        ];
      };
      menu_items: {
        Row: {
          id: string;
          category_id: string;
          name_ar: string;
          name_he: string;
          description: string;
          price: number;
          cost_cache: number;
          image_url: string | null;
          barcode: string | null;
          is_available: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
          printer_id: string | null;
        };
        Insert: {
          id?: string;
          category_id: string;
          name_ar: string;
          name_he?: string;
          description?: string;
          price: number;
          cost_cache?: number;
          image_url?: string | null;
          barcode?: string | null;
          is_available?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
          printer_id?: string | null;
        };
        Update: {
          id?: string;
          category_id?: string;
          name_ar?: string;
          name_he?: string;
          description?: string;
          price?: number;
          cost_cache?: number;
          image_url?: string | null;
          barcode?: string | null;
          is_available?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
          printer_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: "menu_items_category_id_fkey"; columns: ["category_id"]; isOneToOne: false; referencedRelation: "categories"; referencedColumns: ["id"] },
          { foreignKeyName: "menu_items_printer_id_fkey"; columns: ["printer_id"]; isOneToOne: false; referencedRelation: "printers"; referencedColumns: ["id"] },
        ];
      };
      menu_option_recipes: {
        Row: {
          id: string;
          option_id: string;
          ingredient_id: string;
          quantity: number;
          unit: Database["public"]["Enums"]["unit_type"];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          option_id: string;
          ingredient_id: string;
          quantity: number;
          unit: Database["public"]["Enums"]["unit_type"];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          option_id?: string;
          ingredient_id?: string;
          quantity?: number;
          unit?: Database["public"]["Enums"]["unit_type"];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "menu_option_recipes_ingredient_id_fkey"; columns: ["ingredient_id"]; isOneToOne: false; referencedRelation: "ingredients"; referencedColumns: ["id"] },
          { foreignKeyName: "menu_option_recipes_option_id_fkey"; columns: ["option_id"]; isOneToOne: false; referencedRelation: "menu_item_options"; referencedColumns: ["id"] },
        ];
      };
      notifications: {
        Row: {
          id: string;
          type: Database["public"]["Enums"]["notification_type"];
          title: string;
          body: string;
          ref_id: string | null;
          target_roles: Database["public"]["Enums"]["app_role"][];
          read_by: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          type: Database["public"]["Enums"]["notification_type"];
          title: string;
          body?: string;
          ref_id?: string | null;
          target_roles?: Database["public"]["Enums"]["app_role"][];
          read_by?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          type?: Database["public"]["Enums"]["notification_type"];
          title?: string;
          body?: string;
          ref_id?: string | null;
          target_roles?: Database["public"]["Enums"]["app_role"][];
          read_by?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
        ];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          menu_item_id: string | null;
          name_snapshot: string;
          name_he_snapshot: string;
          unit_price_snapshot: number;
          unit_cost_snapshot: number;
          quantity: number;
          line_total: number;
          notes: string;
          kitchen_status: Database["public"]["Enums"]["kitchen_status"];
          created_at: string;
          updated_at: string;
          voided_at: string | null;
          void_reason: string | null;
          voided_by: string | null;
          options: Json;
          staff_price: number | null;
        };
        Insert: {
          id?: string;
          order_id: string;
          menu_item_id?: string | null;
          name_snapshot: string;
          name_he_snapshot?: string;
          unit_price_snapshot: number;
          unit_cost_snapshot?: number;
          quantity: number;
          line_total: number;
          notes?: string;
          kitchen_status?: Database["public"]["Enums"]["kitchen_status"];
          created_at?: string;
          updated_at?: string;
          voided_at?: string | null;
          void_reason?: string | null;
          voided_by?: string | null;
          options?: Json;
          staff_price?: number | null;
        };
        Update: {
          id?: string;
          order_id?: string;
          menu_item_id?: string | null;
          name_snapshot?: string;
          name_he_snapshot?: string;
          unit_price_snapshot?: number;
          unit_cost_snapshot?: number;
          quantity?: number;
          line_total?: number;
          notes?: string;
          kitchen_status?: Database["public"]["Enums"]["kitchen_status"];
          created_at?: string;
          updated_at?: string;
          voided_at?: string | null;
          void_reason?: string | null;
          voided_by?: string | null;
          options?: Json;
          staff_price?: number | null;
        };
        Relationships: [
          { foreignKeyName: "order_items_menu_item_id_fkey"; columns: ["menu_item_id"]; isOneToOne: false; referencedRelation: "menu_items"; referencedColumns: ["id"] },
          { foreignKeyName: "order_items_order_id_fkey"; columns: ["order_id"]; isOneToOne: false; referencedRelation: "orders"; referencedColumns: ["id"] },
          { foreignKeyName: "order_items_voided_by_fkey"; columns: ["voided_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      orders: {
        Row: {
          id: string;
          order_number: number;
          client_ref: string | null;
          type: Database["public"]["Enums"]["order_type"];
          table_no: number | null;
          customer_name: string;
          customer_phone: string;
          customer_address: string;
          status: Database["public"]["Enums"]["order_status"];
          subtotal: number;
          discount_type: Database["public"]["Enums"]["discount_type"] | null;
          discount_value: number;
          discount_amount: number;
          total: number;
          vat_amount: number;
          cost_total: number;
          cashier_id: string | null;
          shift_id: string | null;
          notes: string;
          void_reason: string | null;
          voided_by: string | null;
          voided_at: string | null;
          preparing_at: string | null;
          ready_at: string | null;
          served_at: string | null;
          created_at: string;
          updated_at: string;
          customer_id: string | null;
          payment_status: Database["public"]["Enums"]["payment_status"];
          paid_amount: number;
          staff_employee_id: string | null;
        };
        Insert: {
          id?: string;
          order_number?: number;
          client_ref?: string | null;
          type: Database["public"]["Enums"]["order_type"];
          table_no?: number | null;
          customer_name?: string;
          customer_phone?: string;
          customer_address?: string;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal?: number;
          discount_type?: Database["public"]["Enums"]["discount_type"] | null;
          discount_value?: number;
          discount_amount?: number;
          total?: number;
          vat_amount?: number;
          cost_total?: number;
          cashier_id?: string | null;
          shift_id?: string | null;
          notes?: string;
          void_reason?: string | null;
          voided_by?: string | null;
          voided_at?: string | null;
          preparing_at?: string | null;
          ready_at?: string | null;
          served_at?: string | null;
          created_at?: string;
          updated_at?: string;
          customer_id?: string | null;
          payment_status?: Database["public"]["Enums"]["payment_status"];
          paid_amount?: number;
          staff_employee_id?: string | null;
        };
        Update: {
          id?: string;
          order_number?: number;
          client_ref?: string | null;
          type?: Database["public"]["Enums"]["order_type"];
          table_no?: number | null;
          customer_name?: string;
          customer_phone?: string;
          customer_address?: string;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal?: number;
          discount_type?: Database["public"]["Enums"]["discount_type"] | null;
          discount_value?: number;
          discount_amount?: number;
          total?: number;
          vat_amount?: number;
          cost_total?: number;
          cashier_id?: string | null;
          shift_id?: string | null;
          notes?: string;
          void_reason?: string | null;
          voided_by?: string | null;
          voided_at?: string | null;
          preparing_at?: string | null;
          ready_at?: string | null;
          served_at?: string | null;
          created_at?: string;
          updated_at?: string;
          customer_id?: string | null;
          payment_status?: Database["public"]["Enums"]["payment_status"];
          paid_amount?: number;
          staff_employee_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: "orders_cashier_id_fkey"; columns: ["cashier_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "orders_customer_id_fkey"; columns: ["customer_id"]; isOneToOne: false; referencedRelation: "customers"; referencedColumns: ["id"] },
          { foreignKeyName: "orders_shift_id_fkey"; columns: ["shift_id"]; isOneToOne: false; referencedRelation: "cash_shifts"; referencedColumns: ["id"] },
          { foreignKeyName: "orders_staff_employee_id_fkey"; columns: ["staff_employee_id"]; isOneToOne: false; referencedRelation: "employees_meta"; referencedColumns: ["id"] },
          { foreignKeyName: "orders_voided_by_fkey"; columns: ["voided_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      payments: {
        Row: {
          id: string;
          order_id: string;
          method: Database["public"]["Enums"]["payment_method"];
          amount: number;
          tendered: number | null;
          change_given: number;
          created_at: string;
          updated_at: string;
          shift_id: string | null;
        };
        Insert: {
          id?: string;
          order_id: string;
          method: Database["public"]["Enums"]["payment_method"];
          amount: number;
          tendered?: number | null;
          change_given?: number;
          created_at?: string;
          updated_at?: string;
          shift_id?: string | null;
        };
        Update: {
          id?: string;
          order_id?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          amount?: number;
          tendered?: number | null;
          change_given?: number;
          created_at?: string;
          updated_at?: string;
          shift_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: "payments_order_id_fkey"; columns: ["order_id"]; isOneToOne: false; referencedRelation: "orders"; referencedColumns: ["id"] },
          { foreignKeyName: "payments_shift_id_fkey"; columns: ["shift_id"]; isOneToOne: false; referencedRelation: "cash_shifts"; referencedColumns: ["id"] },
        ];
      };
      payroll: {
        Row: {
          id: string;
          employee_id: string;
          period_month: string;
          hours_worked: number;
          base_amount: number;
          bonuses: number;
          advances: number;
          deductions: number;
          net_amount: number;
          status: Database["public"]["Enums"]["payroll_status"];
          paid_at: string | null;
          notes: string;
          created_at: string;
          updated_at: string;
          days_worked: number;
        };
        Insert: {
          id?: string;
          employee_id: string;
          period_month: string;
          hours_worked?: number;
          base_amount?: number;
          bonuses?: number;
          advances?: number;
          deductions?: number;
          net_amount?: number;
          status?: Database["public"]["Enums"]["payroll_status"];
          paid_at?: string | null;
          notes?: string;
          created_at?: string;
          updated_at?: string;
          days_worked?: number;
        };
        Update: {
          id?: string;
          employee_id?: string;
          period_month?: string;
          hours_worked?: number;
          base_amount?: number;
          bonuses?: number;
          advances?: number;
          deductions?: number;
          net_amount?: number;
          status?: Database["public"]["Enums"]["payroll_status"];
          paid_at?: string | null;
          notes?: string;
          created_at?: string;
          updated_at?: string;
          days_worked?: number;
        };
        Relationships: [
          { foreignKeyName: "payroll_employee_id_fkey"; columns: ["employee_id"]; isOneToOne: false; referencedRelation: "employees_meta"; referencedColumns: ["id"] },
        ];
      };
      printers: {
        Row: {
          id: string;
          name: string;
          kind: string;
          connection: string;
          address: string;
          paper_width: number;
          is_active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          kind?: string;
          connection?: string;
          address?: string;
          paper_width?: number;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          kind?: string;
          connection?: string;
          address?: string;
          paper_width?: number;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
        ];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string;
          role: Database["public"]["Enums"]["app_role"];
          pin_hash: string | null;
          avatar_url: string | null;
          language: string;
          is_active: boolean;
          last_login_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string;
          role?: Database["public"]["Enums"]["app_role"];
          pin_hash?: string | null;
          avatar_url?: string | null;
          language?: string;
          is_active?: boolean;
          last_login_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          role?: Database["public"]["Enums"]["app_role"];
          pin_hash?: string | null;
          avatar_url?: string | null;
          language?: string;
          is_active?: boolean;
          last_login_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
        ];
      };
      purchase_order_items: {
        Row: {
          id: string;
          purchase_order_id: string;
          ingredient_id: string;
          quantity: number;
          unit_cost: number;
          created_at: string;
          updated_at: string;
          cost_before: number | null;
        };
        Insert: {
          id?: string;
          purchase_order_id: string;
          ingredient_id: string;
          quantity: number;
          unit_cost?: number;
          created_at?: string;
          updated_at?: string;
          cost_before?: number | null;
        };
        Update: {
          id?: string;
          purchase_order_id?: string;
          ingredient_id?: string;
          quantity?: number;
          unit_cost?: number;
          created_at?: string;
          updated_at?: string;
          cost_before?: number | null;
        };
        Relationships: [
          { foreignKeyName: "purchase_order_items_ingredient_id_fkey"; columns: ["ingredient_id"]; isOneToOne: false; referencedRelation: "ingredients"; referencedColumns: ["id"] },
          { foreignKeyName: "purchase_order_items_purchase_order_id_fkey"; columns: ["purchase_order_id"]; isOneToOne: false; referencedRelation: "purchase_orders"; referencedColumns: ["id"] },
        ];
      };
      purchase_orders: {
        Row: {
          id: string;
          po_number: number;
          supplier_id: string | null;
          status: Database["public"]["Enums"]["po_status"];
          notes: string;
          expected_date: string | null;
          total: number;
          created_by: string | null;
          sent_at: string | null;
          received_at: string | null;
          received_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          po_number?: number;
          supplier_id?: string | null;
          status?: Database["public"]["Enums"]["po_status"];
          notes?: string;
          expected_date?: string | null;
          total?: number;
          created_by?: string | null;
          sent_at?: string | null;
          received_at?: string | null;
          received_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          po_number?: number;
          supplier_id?: string | null;
          status?: Database["public"]["Enums"]["po_status"];
          notes?: string;
          expected_date?: string | null;
          total?: number;
          created_by?: string | null;
          sent_at?: string | null;
          received_at?: string | null;
          received_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "purchase_orders_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "purchase_orders_received_by_fkey"; columns: ["received_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "purchase_orders_supplier_id_fkey"; columns: ["supplier_id"]; isOneToOne: false; referencedRelation: "suppliers"; referencedColumns: ["id"] },
        ];
      };
      recipe_items: {
        Row: {
          id: string;
          menu_item_id: string;
          ingredient_id: string;
          quantity: number;
          unit: Database["public"]["Enums"]["unit_type"];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          menu_item_id: string;
          ingredient_id: string;
          quantity: number;
          unit: Database["public"]["Enums"]["unit_type"];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          menu_item_id?: string;
          ingredient_id?: string;
          quantity?: number;
          unit?: Database["public"]["Enums"]["unit_type"];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "recipe_items_ingredient_id_fkey"; columns: ["ingredient_id"]; isOneToOne: false; referencedRelation: "ingredients"; referencedColumns: ["id"] },
          { foreignKeyName: "recipe_items_menu_item_id_fkey"; columns: ["menu_item_id"]; isOneToOne: false; referencedRelation: "menu_items"; referencedColumns: ["id"] },
        ];
      };
      restaurant_settings: {
        Row: {
          id: string;
          singleton: boolean;
          name: string;
          slogan: string;
          logo_url: string | null;
          phone: string;
          address: string;
          vat_percent: number;
          receipt_header: string;
          receipt_footer: string;
          offline_mode: boolean;
          auto_sync: boolean;
          order_notifications: boolean;
          kitchen_warn_minutes: number;
          kitchen_late_minutes: number;
          table_count: number;
          seating_capacity: number;
          currency_symbol: string;
          digit_style: string;
          max_discount_cashier_percent: number;
          max_discount_manager_percent: number;
          timezone: string;
          created_at: string;
          updated_at: string;
          payroll_cycle_day: number;
          print_kitchen_on_send: boolean;
        };
        Insert: {
          id?: string;
          singleton?: boolean;
          name?: string;
          slogan?: string;
          logo_url?: string | null;
          phone?: string;
          address?: string;
          vat_percent?: number;
          receipt_header?: string;
          receipt_footer?: string;
          offline_mode?: boolean;
          auto_sync?: boolean;
          order_notifications?: boolean;
          kitchen_warn_minutes?: number;
          kitchen_late_minutes?: number;
          table_count?: number;
          seating_capacity?: number;
          currency_symbol?: string;
          digit_style?: string;
          max_discount_cashier_percent?: number;
          max_discount_manager_percent?: number;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
          payroll_cycle_day?: number;
          print_kitchen_on_send?: boolean;
        };
        Update: {
          id?: string;
          singleton?: boolean;
          name?: string;
          slogan?: string;
          logo_url?: string | null;
          phone?: string;
          address?: string;
          vat_percent?: number;
          receipt_header?: string;
          receipt_footer?: string;
          offline_mode?: boolean;
          auto_sync?: boolean;
          order_notifications?: boolean;
          kitchen_warn_minutes?: number;
          kitchen_late_minutes?: number;
          table_count?: number;
          seating_capacity?: number;
          currency_symbol?: string;
          digit_style?: string;
          max_discount_cashier_percent?: number;
          max_discount_manager_percent?: number;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
          payroll_cycle_day?: number;
          print_kitchen_on_send?: boolean;
        };
        Relationships: [
        ];
      };
      salary_advances: {
        Row: {
          id: string;
          employee_id: string;
          amount: number;
          note: string;
          shift_id: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          amount: number;
          note?: string;
          shift_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          amount?: number;
          note?: string;
          shift_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          { foreignKeyName: "salary_advances_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "salary_advances_employee_id_fkey"; columns: ["employee_id"]; isOneToOne: false; referencedRelation: "employees_meta"; referencedColumns: ["id"] },
          { foreignKeyName: "salary_advances_shift_id_fkey"; columns: ["shift_id"]; isOneToOne: false; referencedRelation: "cash_shifts"; referencedColumns: ["id"] },
        ];
      };
      stock_count_items: {
        Row: {
          id: string;
          stock_count_id: string;
          ingredient_id: string;
          expected_quantity: number;
          counted_quantity: number | null;
          reason: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          stock_count_id: string;
          ingredient_id: string;
          expected_quantity?: number;
          counted_quantity?: number | null;
          reason?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          stock_count_id?: string;
          ingredient_id?: string;
          expected_quantity?: number;
          counted_quantity?: number | null;
          reason?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "stock_count_items_ingredient_id_fkey"; columns: ["ingredient_id"]; isOneToOne: false; referencedRelation: "ingredients"; referencedColumns: ["id"] },
          { foreignKeyName: "stock_count_items_stock_count_id_fkey"; columns: ["stock_count_id"]; isOneToOne: false; referencedRelation: "stock_counts"; referencedColumns: ["id"] },
        ];
      };
      stock_counts: {
        Row: {
          id: string;
          status: Database["public"]["Enums"]["stock_count_status"];
          notes: string;
          created_by: string | null;
          applied_at: string | null;
          applied_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          status?: Database["public"]["Enums"]["stock_count_status"];
          notes?: string;
          created_by?: string | null;
          applied_at?: string | null;
          applied_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          status?: Database["public"]["Enums"]["stock_count_status"];
          notes?: string;
          created_by?: string | null;
          applied_at?: string | null;
          applied_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "stock_counts_applied_by_fkey"; columns: ["applied_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "stock_counts_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      stock_movements: {
        Row: {
          id: string;
          ingredient_id: string;
          change: number;
          quantity_after: number;
          reason: Database["public"]["Enums"]["stock_reason"];
          ref_id: string | null;
          note: string;
          user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          ingredient_id: string;
          change: number;
          quantity_after: number;
          reason: Database["public"]["Enums"]["stock_reason"];
          ref_id?: string | null;
          note?: string;
          user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          ingredient_id?: string;
          change?: number;
          quantity_after?: number;
          reason?: Database["public"]["Enums"]["stock_reason"];
          ref_id?: string | null;
          note?: string;
          user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "stock_movements_ingredient_id_fkey"; columns: ["ingredient_id"]; isOneToOne: false; referencedRelation: "ingredients"; referencedColumns: ["id"] },
          { foreignKeyName: "stock_movements_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      suppliers: {
        Row: {
          id: string;
          name: string;
          contact_name: string;
          phone: string;
          email: string;
          address: string;
          notes: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          contact_name?: string;
          phone?: string;
          email?: string;
          address?: string;
          notes?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          contact_name?: string;
          phone?: string;
          email?: string;
          address?: string;
          notes?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
        ];
      };
      user_permissions: {
        Row: {
          user_id: string;
          permission: string;
          expires_at: string | null;
          granted_by: string | null;
          created_at: string;
          effect: string;
        };
        Insert: {
          user_id: string;
          permission: string;
          expires_at?: string | null;
          granted_by?: string | null;
          created_at?: string;
          effect?: string;
        };
        Update: {
          user_id?: string;
          permission?: string;
          expires_at?: string | null;
          granted_by?: string | null;
          created_at?: string;
          effect?: string;
        };
        Relationships: [
          { foreignKeyName: "user_permissions_granted_by_fkey"; columns: ["granted_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "user_permissions_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      work_shifts: {
        Row: {
          id: string;
          employee_id: string;
          shift_date: string;
          start_time: string;
          end_time: string;
          notes: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          shift_date: string;
          start_time: string;
          end_time: string;
          notes?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          shift_date?: string;
          start_time?: string;
          end_time?: string;
          notes?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "work_shifts_employee_id_fkey"; columns: ["employee_id"]; isOneToOne: false; referencedRelation: "employees_meta"; referencedColumns: ["id"] },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      add_payment: { Args: { p_order_id: string; p_payments: Json }; Returns: Json };
      adjust_stock: { Args: { p_ingredient_id: string; p_change: number; p_reason: Database["public"]["Enums"]["stock_reason"]; p_note: string }; Returns: number };
      admin_create_user: { Args: { p_email: string; p_password: string; p_full_name: string; p_role: Database["public"]["Enums"]["app_role"]; p_phone?: string; p_pin?: string; p_employee_id?: string }; Returns: string };
      admin_set_password: { Args: { p_user_id: string; p_password: string }; Returns: undefined };
      admin_update_profile: { Args: { p_user_id: string; p_role: Database["public"]["Enums"]["app_role"]; p_is_active: boolean }; Returns: Database["public"]["Tables"]["profiles"]["Row"] };
      advance_kitchen_status: { Args: { p_order_id: string; p_status: Database["public"]["Enums"]["kitchen_status"] }; Returns: Json };
      apply_stock_count: { Args: { p_count_id: string }; Returns: Json };
      check_range: { Args: { p_from: string; p_to: string }; Returns: undefined };
      clock_in: { Args: { p_employee_id?: string }; Returns: Database["public"]["Tables"]["attendance"]["Row"] };
      clock_out: { Args: { p_employee_id?: string }; Returns: Database["public"]["Tables"]["attendance"]["Row"] };
      close_shift: { Args: { p_counted_cash: number; p_notes?: string }; Returns: Json };
      compute_payroll: { Args: { p_month: string }; Returns: number };
      cost_data: { Args: Record<PropertyKey, never>; Returns: Json };
      create_stock_count: { Args: { p_notes?: string }; Returns: string };
      current_user_role: { Args: Record<PropertyKey, never>; Returns: Database["public"]["Enums"]["app_role"] };
      daily_report: { Args: { p_date?: string }; Returns: Json };
      dashboard_extra: { Args: Record<PropertyKey, never>; Returns: Json };
      dashboard_today: { Args: Record<PropertyKey, never>; Returns: Json };
      delete_record: { Args: { p_entity: string; p_id: string; p_dry_run?: boolean }; Returns: Json };
      delete_records: { Args: { p_entity: string; p_ids: string[]; p_dry_run?: boolean }; Returns: Json };
      find_customers: { Args: { p_query: string }; Returns: Json };
      get_order: { Args: { p_order_id: string }; Returns: Json };
      has_perm: { Args: { p: string }; Returns: boolean };
      has_role: { Args: { roles: Database["public"]["Enums"]["app_role"][] }; Returns: boolean };
      import_backup: { Args: { p_data: Json }; Returns: Json };
      inventory_insights: { Args: { p_days?: number }; Returns: Json };
      is_manager: { Args: Record<PropertyKey, never>; Returns: boolean };
      kiosk_absent: { Args: { p_employee_id: string; p_date?: string }; Returns: Json };
      kiosk_clock: { Args: { p_employee_id: string; p_action: string }; Returns: Json };
      local_date: { Args: { p_ts: string }; Returns: string };
      log_pos_cancel: { Args: { p_reason: string; p_items: number; p_total: number }; Returns: undefined };
      mark_notifications_read: { Args: { p_ids?: string[] }; Returns: undefined };
      my_permissions: { Args: Record<PropertyKey, never>; Returns: string[] };
      normalize_phone: { Args: { p: string }; Returns: string };
      open_shift: { Args: { p_opening_float: number }; Returns: Database["public"]["Tables"]["cash_shifts"]["Row"] };
      options_out_of_stock: { Args: Record<PropertyKey, never>; Returns: Json };
      payroll_range: { Args: { p_month: string }; Returns: unknown[] };
      perm_locked: { Args: { p_role: Database["public"]["Enums"]["app_role"]; p: string }; Returns: boolean };
      place_order: { Args: { payload: Json }; Returns: Json };
      po_item_costs: { Args: { p_po_id: string }; Returns: Json };
      range_end: { Args: { p_to: string }; Returns: string };
      range_start: { Args: { p_from: string }; Returns: string };
      receive_goods: { Args: { p_lines: Json; p_supplier_id: string; p_date: string; p_notes?: string }; Returns: string };
      receive_purchase_order: { Args: { p_po_id: string }; Returns: Database["public"]["Tables"]["purchase_orders"]["Row"] };
      record_advance: { Args: { p_employee_id: string; p_amount: number; p_note?: string }; Returns: string };
      replace_order_item: { Args: { p_item_id: string; p_menu_item_id: string; p_quantity: number; p_notes: string; p_reason: string }; Returns: Json };
      report_cash: { Args: { p_from: string; p_to: string }; Returns: Json };
      report_cashiers: { Args: { p_from: string; p_to: string }; Returns: Json };
      report_employees: { Args: { p_from: string; p_to: string }; Returns: Json };
      report_hourly: { Args: { p_from: string; p_to: string }; Returns: Json };
      report_inventory: { Args: { p_from: string; p_to: string }; Returns: Json };
      report_orders: { Args: { p_from: string; p_to: string }; Returns: Json };
      report_payments: { Args: { p_from: string; p_to: string }; Returns: Json };
      report_profit: { Args: { p_from: string; p_to: string }; Returns: Json };
      report_purchases: { Args: { p_from: string; p_to: string }; Returns: Json };
      report_sales: { Args: { p_from: string; p_to: string }; Returns: Json };
      report_staff: { Args: { p_from: string; p_to: string }; Returns: Json };
      report_staff_meals: { Args: { p_from: string; p_to: string }; Returns: Json };
      report_tax: { Args: { p_from: string; p_to: string }; Returns: Json };
      report_top_items: { Args: { p_from: string; p_to: string; p_limit?: number }; Returns: Json };
      require_perm: { Args: { p: string }; Returns: undefined };
      restaurant_tz: { Args: Record<PropertyKey, never>; Returns: string };
      role_defaults: { Args: { p_role: Database["public"]["Enums"]["app_role"] }; Returns: string[] };
      set_pin: { Args: { p_user_id: string; p_pin: string }; Returns: undefined };
      shift_report: { Args: { p_shift_id: string }; Returns: Json };
      staff_board: { Args: Record<PropertyKey, never>; Returns: Json };
      touch_last_login: { Args: Record<PropertyKey, never>; Returns: undefined };
      unit_factor: { Args: { p_from: Database["public"]["Enums"]["unit_type"]; p_to: Database["public"]["Enums"]["unit_type"] }; Returns: number };
      void_order: { Args: { p_order_id: string; p_reason: string; p_refund?: boolean }; Returns: Json };
      void_order_item: { Args: { p_item_id: string; p_quantity: number; p_reason: string }; Returns: Json };
    };
    Enums: {
      app_role: "owner" | "manager" | "cashier" | "kitchen" | "inventory";
      discount_type: "percent" | "fixed";
      expense_category: "rent" | "utilities" | "salaries" | "supplies" | "maintenance" | "marketing" | "other";
      kitchen_status: "new" | "preparing" | "ready" | "served";
      notification_type: "low_stock" | "new_order" | "void" | "system";
      order_status: "new" | "preparing" | "ready" | "served" | "cancelled" | "refunded";
      order_type: "dine_in" | "takeaway" | "delivery";
      payment_method: "cash" | "card";
      payment_status: "paid" | "partial" | "unpaid";
      payroll_status: "draft" | "paid";
      po_status: "draft" | "sent" | "received" | "cancelled";
      salary_type: "monthly" | "hourly" | "daily";
      stock_count_status: "draft" | "applied";
      stock_reason: "sale" | "purchase" | "adjustment" | "waste" | "void";
      unit_type: "kg" | "g" | "l" | "ml" | "piece" | "carton";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database["public"];
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "manager", "cashier", "kitchen", "inventory"],
      discount_type: ["percent", "fixed"],
      expense_category: ["rent", "utilities", "salaries", "supplies", "maintenance", "marketing", "other"],
      kitchen_status: ["new", "preparing", "ready", "served"],
      notification_type: ["low_stock", "new_order", "void", "system"],
      order_status: ["new", "preparing", "ready", "served", "cancelled", "refunded"],
      order_type: ["dine_in", "takeaway", "delivery"],
      payment_method: ["cash", "card"],
      payment_status: ["paid", "partial", "unpaid"],
      payroll_status: ["draft", "paid"],
      po_status: ["draft", "sent", "received", "cancelled"],
      salary_type: ["monthly", "hourly", "daily"],
      stock_count_status: ["draft", "applied"],
      stock_reason: ["sale", "purchase", "adjustment", "waste", "void"],
      unit_type: ["kg", "g", "l", "ml", "piece", "carton"],
    },
  },
} as const;
