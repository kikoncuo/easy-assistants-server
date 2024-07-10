cube(`SalesOutlet`, {
  sql: `SELECT * FROM public.csv_sales_outlet`,

  measures: {
    count: {
      type: `count`,
    },
    avgSquareFeet: {
      sql: `store_square_feet`,
      type: `avg`
    },
  },

  dimensions: {
    id: {
      sql: `sales_outlet_id`,
      type: `number`,
      primaryKey: true
    },
    type: {
      sql: `sales_outlet_type`,
      type: `string`
    },
    address: {
      sql: `store_address`,
      type: `string`
    },
    city: {
      sql: `store_city`,
      type: `string`
    },
    stateProvince: {
      sql: `store_state_province`,
      type: `string`
    },
    telephone: {
      sql: `store_telephone`,
      type: `string`
    },
    postalCode: {
      sql: `store_postal_code`,
      type: `string`
    },
    longitude: {
      sql: `store_longitude`,
      type: `number`
    },
    latitude: {
      sql: `store_latitude`,
      type: `number`
    },
    manager: {
      sql: `manager`,
      type: `string`
    },
    neighborhood: {
      sql: `Neighorhood`,
      type: `string`
    },
  }
});