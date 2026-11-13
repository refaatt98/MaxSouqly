// Readable columns of tables whose cost figures are hidden by the database.
// `select('*')` is refused on these tables; cost figures come from `cost_data()` for users allowed to see them.
export const MENU_ITEM_COLS = 'id, category_id, name_ar, name_he, description, price, image_url, barcode, is_available, sort_order, created_at, updated_at, printer_id' as const;
export const INGREDIENT_COLS = 'id, name_ar, name_he, unit, quantity, min_quantity, image_url, supplier_id, is_active, created_at, updated_at' as const;
export const PO_COLS = 'id, po_number, supplier_id, status, notes, expected_date, created_by, sent_at, received_at, received_by, created_at, updated_at' as const;
export const PO_ITEM_COLS = 'id, purchase_order_id, ingredient_id, quantity, created_at, updated_at' as const;
export const ORDER_COLS =
  'id, order_number, client_ref, type, table_no, customer_name, customer_phone, customer_address, status, subtotal, discount_type, discount_value, discount_amount, total, vat_amount, cashier_id, shift_id, notes, void_reason, voided_by, voided_at, preparing_at, ready_at, served_at, created_at, updated_at, customer_id, payment_status, paid_amount' as const;
