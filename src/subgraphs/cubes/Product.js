cube(`Product`, {
  sql: `SELECT * FROM public.csv_products`,

  measures: {
    count: {
      type: `count`,
    },
    avgWholesalePrice: {
      sql: `current_wholesale_price`,
      type: `avg`
    },
    avgRetailPrice: {
      sql: `current_retail_price`,
      type: `avg`
    },
  },

  dimensions: {
    id: {
      sql: `product_id`,
      type: `number`,
      primaryKey: true
    },
    group: {
      sql: `product_group`,
      type: `string`
    },
    category: {
      sql: `product_category`,
      type: `string`
    },
    type: {
      sql: `product_type`,
      type: `string`
    },
    name: {
      sql: `product`,
      type: `string`
    },
    description: {
      sql: `product_description`,
      type: `string`
    },
    unitOfMeasure: {
      sql: `unit_of_measure`,
      type: `string`
    },
    isTaxExempt: {
      sql: `tax_exempt_yn`,
      type: `string`
    },
    isPromo: {
      sql: `promo_yn`,
      type: `string`
    },
    isNewProduct: {
      sql: `new_product_yn`,
      type: `string`
    },
  }
});