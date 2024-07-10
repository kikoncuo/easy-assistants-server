cube(`Staff`, {
  sql: `SELECT * FROM public.csv_staff`,

  measures: {
    count: {
      type: `count`,
    },
  },

  dimensions: {
    id: {
      sql: `staff_id`,
      type: `number`,
      primaryKey: true
    },
    firstName: {
      sql: `first_name`,
      type: `string`
    },
    lastName: {
      sql: `last_name`,
      type: `string`
    },
    position: {
      sql: `position`,
      type: `string`
    },
    startDate: {
      sql: `start_date`,
      type: `time`
    },
    location: {
      sql: `location`,
      type: `string`
    },
  }
});