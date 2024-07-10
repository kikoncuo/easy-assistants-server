cube(`Customer`, {
  sql: `SELECT * FROM public.csv_customers`,

  measures: {
    count: {
      type: `count`,
    },
  },

  dimensions: {
    id: {
      sql: `customer_id`,
      type: `number`,
      primaryKey: true
    },
    homeStore: {
      sql: `home_store`,
      type: `number`
    },
    firstName: {
      sql: `customer_first_name`,
      type: `string`
    },
    email: {
      sql: `customer_email`,
      type: `string`
    },
    customerSince: {
      sql: `customer_since`,
      type: `time`
    },
    loyaltyCardNumber: {
      sql: `loyalty_card_number`,
      type: `string`
    },
    birthdate: {
      sql: `birthdate`,
      type: `time`
    },
    gender: {
      sql: `gender`,
      type: `string`
    },
    birthYear: {
      sql: `birth_year`,
      type: `number`
    },
  }
});