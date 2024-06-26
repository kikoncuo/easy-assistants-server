export const dataExample = `
Tables:

Table: csv_customers
 - customer_id (integer): [1,2,3];  - home_store (integer): [3,5,8];  - customer_first_name (text): ["Abraham","Cherokee West","Warren"];  - customer_email (text): ["Lavinia@Donec.gov","Vaughan@habitant.gov","Rae@ac.edu"];  - customer_since (date): ["2017-11-07T23:00:00.000Z","2017-10-04T22:00:00.000Z","2018-01-12T23:00:00.000Z"];  - loyalty_card_number (text): ["368-309-5743","196-868-2529","726-654-4316"];  - birthdate (date): ["1974-09-05T22:00:00.000Z","1996-06-03T22:00:00.000Z","1984-06-04T22:00:00.000Z"];  - gender (text): ["N","M","F"];  - birth_year (integer): [1991,1989,1974]

Table: csv_dates_info
 - transaction_date (date): ["2019-04-19T22:00:00.000Z","2019-04-28T22:00:00.000Z","2019-04-20T22:00:00.000Z"];  - date_id (text): ["20190410","20190428","20190418"];  - week_id (integer): [15,14,17];  - week_desc (text): ["Week 17","Week 18","Week 15"];  - month_id (integer): [4];  - month_name (text): ["April"];  - quarter_id (integer): [2];  - quarter_name (text): ["Q2"];  - year_id (integer): [2019];  - id (uuid): ["00e05bed-1241-49c9-b4fd-056b244bc243","0a299c68-a885-4312-9399-99583137319e","0e5ce664-7f6c-4eae-a462-4998c00d4fe6"]

Table: csv_generations
 - birth_year (integer): [1946,1947,1948];  - generation (text): ["Younger_Millennials","Older_Millennials","Gen_Z"]

Table: csv_pastry_inventory
 - sales_outlet_id (integer): [3,5,8];  - transaction_date (date): ["2019-04-05T22:00:00.000Z","2019-03-31T22:00:00.000Z","2019-04-25T22:00:00.000Z"];  - product_id (integer): [69,72,70];  - start_of_day (integer): [18,48];  - quantity_sold (integer): [29,4,0];  - waste (integer): [42,29,4];  - percent_waste (text): ["96%","72%","58%"];  - id (uuid): ["007667dd-8129-4e8c-bac8-1e8d5371d0fc","01de5a54-0e8e-47b1-ab69-b5f97db38d82","0430ce55-d270-4273-b437-302456eaa9e2"]

Table: csv_products
 - product_id (integer): [1,2,3];  - product_group (text): ["Whole Bean/Teas","Add-ons","Food"];  - product_category (text): ["Flavours","Bakery","Branded"];  - product_type (text): ["Clothing","Organic Chocolate","Barista Espresso"];  - product (text): ["Croissant","Morning Sunrise Chai","Peppermint"];  - product_description (text): ["Our primium single source of hand roasted beans.","Added marshmallows for the needed sugar rush.","Grannys fav"];  - unit_of_measure (text): ["1 lb","1 oz","16 oz"];  - current_wholesale_price (real): [2.25,2.63,0.4];  - current_retail_price (text): ["$28.00 ","$8.95 ","$5.95 "];  - tax_exempt_yn (text): ["Y","N"];  - promo_yn (text): ["Y","N"];  - new_product_yn (text): ["Y","N"]

Table: csv_sales_outlet
 - sales_outlet_id (integer): [8,10,9];  - sales_outlet_type (text): ["retail","warehouse"];  - store_square_feet (text): ["1600","1200","3400"];  - store_address (text): ["164-14 Jamaica Ave","100 Church Street","604 Union Street"];  - store_city (text): ["Long Island City","New York","Brooklyn"];  - store_state_province (text): ["NY"];  - store_telephone (text): ["613-555-4989","343-212-5151","972-871-0402"];  - store_postal_code (text): ["10014","10021","10036"];  - store_longitude (text): ["-73.992687","-73.983984","-73.924008"];  - store_latitude (text): ["40.761196","40.734367","40.74276"];  - manager (integer): [36,31,16];  - neighorhood (text): ["Chelsea","Lower East Side","Astoria"]

Table: csv_sales_reciepts
 - transaction_id (integer): [1489,273,3936];  - transaction_date (date): ["2019-04-05T22:00:00.000Z","2019-03-31T22:00:00.000Z","2019-04-25T22:00:00.000Z"];  - transaction_time (text): ["17:49:24","10:19:56","16:24:23"];  - sales_outlet_id (integer): [3,5,8];  - staff_id (integer): [44,42,43];  - customer_id (integer): [8318,652,273];  - instore_yn (text): ["Y"," ","N"];  - order_ (text): ["1","4","9"];  - line_item_id (integer): [9,3,5];  - product_id (integer): [87,71,51];  - quantity (integer): [3,4,6];  - line_item_amount (real): [0,4.38,12.75];  - unit_price (text): ["5.63","4.38","28.00"];  - promo_item_yn (text): ["Y","N"]

Table: csv_sales_target
 - sales_outlet_id (integer): [8,10,7];  - year_month (text): ["2019-04"];  - beans_goal (integer): [900,1000,720];  - beverage_goal (integer): [16875,18750,13500];  - food_goal (integer): [4750,4275,3420];  - merchandise_goal (integer): [360,500,450];  - total_goal (integer): [22500,25000,18000]

Table: csv_staff
 - staff_id (integer): [1,2,3];  - first_name (text): ["Chelsea","Tamekah","Ezekiel"];  - last_name (text): ["Kaitlin","Bianca","Paloma"];  - position (text): ["Coffee Wrangler","CEO","Store Manager"];  - start_date (date): ["2014-01-06T23:00:00.000Z","2019-03-20T23:00:00.000Z","2006-03-24T23:00:00.000Z"];  - location (text): ["WH","9","4"];  - _ (text): [""];  - _1 (text): [""]

`