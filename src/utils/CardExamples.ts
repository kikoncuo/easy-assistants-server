export const fallbackCardExamples = `
**Example 1:**

    **Natural Language Query:**
    Show me a bar chart of the top 20 items by number of orders for the last month.

    **JSON Representation:**
    {
    "name": "Top 20 Items by Orders (Last Month)",
    "display": "bar",
    "dataset_query": {
      "database": YourDBIDProvidedInPrompt,
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
    "visualization_settings": {
      "graph.show_values": true,
      "graph.x_axis.title_text": "Item name",
      "graph.y_axis.title_text": "Number of orders",
      "graph.dimensions": [
        "itemName"
      ],
      "graph.metrics": [
        "sum"
      ]
    }
  }
`;