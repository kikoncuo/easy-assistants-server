export const fallbackCardExamples = (databaseID: number) => `
**Example 1:**

    **Natural Language Query:**
    Show me a bar chart of the top 20 items by number of orders for the last month.

    **JSON Representation:**
    {
    "name": "Top 20 Items by Orders (Last Month)",
    "display": "bar",
    "dataset_query": {
      "database": ${databaseID},
      "type": "query",
      "query": {
        "filter": [
          "not-empty",
          [
            "field",
            "Product - CubeJoinField__itemName",
            {
              "base-type": "type/Text"
            }
          ]
        ],
        "source-query": {
          "source-table": 136,
          "joins": [
            {
              "strategy": "left-join",
              "alias": "Product - CubeJoinField",
              "condition": [
                "=",
                [
                  "field",
                  1937,
                  {
                    "base-type": "type/Text"
                  }
                ],
                [
                  "field",
                  1973,
                  {
                    "base-type": "type/Text",
                    "join-alias": "Product - CubeJoinField"
                  }
                ]
              ],
              "source-table": 139
            }
          ],
          "aggregation": [
            [
              "sum",
              [
                "field",
                1944,
                {
                  "base-type": "type/BigInteger"
                }
              ]
            ]
          ],
          "breakout": [
            [
              "field",
              1969,
              {
                "base-type": "type/Text",
                "join-alias": "Product - CubeJoinField"
              }
            ]
          ],
          "limit": 20,
          "order-by": [
            [
              "desc",
              [
                "aggregation",
                0
              ]
            ]
          ],
          "filter": [
            "time-interval",
            [
              "field",
              1940,
              {
                "base-type": "type/DateTime"
              }
            ],
            -1,
            "month"
          ]
        }
      }
    },
  }



**Example 2:**

    **Natural Language Query:**
    Show me a line graph of the total sales by product

    **JSON Representation:**
    {
    "name": "Total Sales by Product",
    "display": "line",
    "dataset_query": {
      "database": ${databaseID},
      "type":"query",
      "query":{
        "source-table":142,
        "aggregation":[
          ["sum",
            [
              "field",
              2270,
              {"base-type":"type/Decimal"}
            ]
          ]
        ],
        "breakout":[
          [
            "field",
            2090,
            {"base-type":"type/Text","join-alias":"Product"}
          ]
        ],
        "joins":[{
          "fields":"all",
          "alias":"Product",
          "condition":[
            "=",
            [
              "field",
              2038,
              null
            ],
            [
              "field",
              2092,
              {"join-alias":"Product"}
            ]
          ],
          "source-table":147
          }
        ],
        "filter":
          [
            "not-empty",
            [
              "field",
              2027,
              {"base-type":"type/DateTime"}
            ]
          ]
        }
      }
  }



**Example 3:**

    **Natural Language Query:**
    Make a bar chart showing the average cost of wasted products by day of the week

    **JSON Representation:**
    {
    "name": "Average Cost of Wastage by Day of the Week",
    "display": "bar",
    "dataset_query": {
      "database": ${databaseID},
      "type":"query",
      "query":{
        "aggregation":
          [
            [
              "avg",
              [
                "field",
                2334,
                {"base-type":"type/Decimal"}
              ]
            ]
          ],
        "breakout":
          [
            [
              "field",
              2090,
              {"base-type":"type/Text","join-alias":"Product - CubeJoinField"}
            ],
            [
              "field",
              2305,
              {"base-type":"type/Text"}
            ]
          ],
        "joins":
          [
            {
              "alias":"Product - CubeJoinField",
              "strategy":"left-join",
              "condition":[
                "=",
                [
                  "field",
                  2054,
                  {"base-type":"type/Text"}
                ],
                [
                  "field",
                  2092,
                  {"base-type":"type/Text","join-alias":"Product - CubeJoinField"}
                ]
              ],
              "source-table":147
            },
            {
              "alias":"Location - CubeJoinField",
              "fields":"all",
              "strategy":"left-join",
              "condition":[
                "=",
                [
                  "field",
                  2054,
                  {"base-type":"type/Text"}
                ],
                [
                  "field",
                  2099,
                  {"base-type":"type/Text","join-alias":"Location - CubeJoinField"}
                ]
              ],
              "source-table":148
              }
            ],
          "source-table":145,
          "filter":[
            "not-empty",
            [
              "field",
              2305,
              {"base-type":"type/Text"}
            ]
          ]
        }
      }
`;

export const fallbackSQLCardExamples = (databaseID: number) => `
**Example 1:**

    **Natural Language Query:**
    Get me the top 5 products

    **Dataset query:**
    {
      "database": ${databaseID},
      "type": "native",
      "native": {
        "query": "SELECT p.itemName, i.totalSold FROM Inventory i JOIN Product p ON i.productId = p.productId AND i.__cubeJoinField = p.__cubeJoinField WHERE i.__cubeJoinField = i.__cubeJoinField ORDER BY i.totalSold DESC LIMIT 5"
      }
    }

**Example 2:**

    **Natural Language Query:**
    Show me the total sales by product

    **Dataset query:**
    {
      "database": ${databaseID},
      "type": "native",
      "native": {
        "query": "SELECT p.itemName, o.createdAt::DATE as date, SUM(o.totalSold) as total_sold, SUM(o.totalGrossRevenue) as total_gross_revenue FROM \"Order\" o JOIN Product p ON o.__cubeJoinField = p.__cubeJoinField JOIN Inventory i ON p.productId = i.productId AND p.__cubeJoinField = i.__cubeJoinField WHERE o.__cubeJoinField = o.__cubeJoinField GROUP BY p.itemName, o.createdAt::DATE ORDER BY o.createdAt::DATE, p.itemName"
      }
    }

**Example 3:**

    **Natural Language Query:**
    Show the average cost of wasted products by day of the week

    **Dataset query:**
    {
      "database": ${databaseID},
      "type": "native",
      "native": {
        "query": "SELECT TO_CHAR(date, 'Day') AS day_of_week, AVG(averageCostOfWastage) AS avg_cost_of_wastage FROM Inventory WHERE __cubeJoinField = __cubeJoinField GROUP BY TO_CHAR(date, 'Day'), EXTRACT(DOW FROM date) ORDER BY EXTRACT(DOW FROM date)"
      }
    }


`;