cube(`Sales`, {
  sql: `SELECT * FROM public.csv_sales_reciepts`,

  joins: {
    Product: {
      relationship: `belongsTo`,
      sql: `${CUBE}.product_id = ${Product}.product_id`
    },
    Staff: {
      relationship: `belongsTo`,
      sql: `${CUBE}.staff_id = ${Staff}.staff_id`
    },
    SalesOutlet: {
      relationship: `belongsTo`,
      sql: `${CUBE}.sales_outlet_id = ${SalesOutlet}.sales_outlet_id`
    },
    Customer: {
      relationship: `belongsTo`,
      sql: `${CUBE}.customer_id = ${Customer}.customer_id`
    }
  },

  measures: {
    count: {
      type: `count`,
    },
    totalSales: {
      sql: `line_item_amount`,
      type: `sum`
    },
    avgSale: {
      sql: `line_item_amount`,
      type: `avg`
    },
    totalQuantity: {
      sql: `quantity`,
      type: `sum`
    },
  },

  dimensions: {
    id: {
      sql: `transaction_id`,
      type: `number`,
      primaryKey: true
    },
    date: {
      sql: `transaction_date`,
      type: `time`
    },
    time: {
      sql: `transaction_time`,
      type: `time`
    },
    inStore: {
      sql: `instore_yn`,
      type: `string`
    },
    order: {
      sql: `order`,
      type: `string`
    },
    lineItemId: {
      sql: `line_item_id`,
      type: `number`
    },
    unitPrice: {
      sql: `unit_price`,
      type: `number`
    },
    promoItem: {
      sql: `promo_item_yn`,
      type: `string`
    },
  }
});