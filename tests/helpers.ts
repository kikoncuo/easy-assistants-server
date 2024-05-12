
  const TestTables = `Transactions Table
  TransactionID: A unique identifier for each transaction (Primary Key).
  UserID: The identifier for the user who made the transaction, linking to the Users table (Foreign Key).
  ProductID: The identifier for the product involved in the transaction, linking to the Products table (Foreign Key).
  Quantity: The number of products purchased in the transaction.
  Price: The price of the product at the time of the transaction.
  Date: The date and time when the transaction took place.
  PaymentMethod: The method of payment used (e.g., credit card, PayPal, etc.).

Users Table
  UserID: A unique identifier for each user (Primary Key).
  FirstName: The first name of the user.
  LastName: The last name of the user.
  Email: The email address of the user.
  SignUpDate: The date when the user created their account.
  LastLogin: The date and time of the user's last login.

Products Table
  ProductID: A unique identifier for each product (Primary Key).
  ProductName: The name of the product.
  Description: A brief description of the product.
  Price: The current price of the product.
  StockQuantity: The number of units of the product currently in stock.
  Category: The category or type of the product.
Example: if the user asks for an ordered list of revenue based on user id, try to generate a query like this: select "USER_ID", "NAME", "EMAIL", sum(cast("REVENUE" as numeric)) as total_revenue from "snowflake_OFFER_CHECKOUT" group by "USER_ID", "REVENUE" order by total_revenue desc;`

export default TestTables;