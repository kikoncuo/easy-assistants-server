export const queryStructureExamples = `
**Example 1:**

    **Natural Language Task:**
    Show me the average sales and percent of units wasted for each product in June

    **JSON Representation:**
    {
      "source_tables": [
        "Inventory",
        "Product"
      ],
      "fields": [
        "Inventory.createdAt",
        "Product.itemName"
      ],
      "aggregations": [
        {"type": "avg", "field": "Inventory.averageSold"},
        {"type": "custom", "expression": "['aggregation-options', ['/', ['sum', ['field', 2333, {'base_type': 'type/Decimal'}]], ['sum', ['field', 2052, {'base_type': 'type/Decimal'}]]], {'name': '% Units Wasted', 'display_name': '% Units Wasted'}]"}
      ],
      "filters": [
        {"field": "Inventory.createdAt", "operator": "not empty"},
        {"field": "Product.itemName", "operator": "not empty"},
        {"field": "Inventory.createdAt", "operator": "between", "value1": "2024-06-01", "value2": "2024-06-30"}
      ],
      "order_by": [{"field": "Inventory.createdAt", "direction": "asc"}]
    }

**Example 2:**

    **Natural Language Task:**
    Show me average customer satisfaction ratings, total orders and the percentage of ratings 4.5 or above across product categories

    **JSON Representation:**
    {
      "source_tables": [
        "orders"
      ],
      "fields": [
        "orders.product_category",
      ],
      "aggregations": [
        {"type": "count", "field": "orders.id"},
        {"type": "avg", "field": "orders.rating"},
        {"type": "custom", "expression": "(count(case when orders.rating >= 4.5 then 1 else null end) / count(orders.rating) * 100", "alias": "percent_ratings_4.5_or_higher"},
      ],
      "filters": [
        {"field": "orders.created_at", "operator": "not empty"},

      ],
      "order_by": [{"field": "orders.created_at", "direction": "asc"}]
    }

`