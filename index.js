require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();
const PORT = process.env.PORT || 3000;
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;
const MONDAY_API_URL = "https://api.monday.com/v2";

if (!MONDAY_API_TOKEN) {
  console.error("Erro: MONDAY_API_TOKEN não definido.");
  process.exit(1);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const axiosInstance = axios.create({
  baseURL: MONDAY_API_URL,
  headers: {
    Authorization: MONDAY_API_TOKEN,
    "Content-Type": "application/json",
  },
  timeout: 60000, // Reduzindo timeout para evitar consumo excessivo
});

async function fetchAllItems(boardId) {
  let items = [];
  let cursor = null;

  try {
    do {
      const query = `
        query {
          boards(ids: ${boardId}) {
            items_page(limit: 50, cursor: ${cursor ? `"${cursor}"` : null}) {
              cursor
              items {
                id
                column_values { id, value }
              }
            }
          }
        }`;
      
      const response = await axiosInstance.post("", { query });
      const boardData = response.data.data?.boards?.[0]?.items_page;
      if (boardData) {
        items = items.concat(boardData.items);
        cursor = boardData.cursor;
      } else {
        break;
      }
    } while (cursor);
  } catch (error) {
    console.error("Erro ao buscar itens do board:", error.response?.data || error.message);
  }
  return items;
}

async function updateSaldo(boardId, itemId, novoSaldo) {
  try {
    const mutation = `
      mutation {
        change_column_value(
          board_id: ${boardId},
          item_id: ${itemId},
          column_id: "saldo",
          value: "{\"number\": ${novoSaldo}}"
        ) {
          id
        }
      }`;
    
    await axiosInstance.post("", { query: mutation });
  } catch (error) {
    console.error(`Erro ao atualizar saldo para o item ${itemId}:`, error.response?.data || error.message);
  }
}

app.post("/webhook", async (req, res) => {
  if (req.body.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }
  console.log("Recebendo Webhook:", JSON.stringify(req.body, null, 2));
  const payload = req.body.event || {};

  if (!payload.boardId || !payload.pulseId) {
    return res.status(400).json({ error: "Payload inválido" });
  }

  const { boardId, pulseId } = payload;
  const items = await fetchAllItems(boardId);
  const itemIndex = items.findIndex(item => item.id == pulseId);
  
  if (itemIndex === -1) {
    return res.status(404).json({ error: "Item não encontrado" });
  }

  let saldo = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const creditDebitColumn = item.column_values.find(col => col.id === "credit_debit");
    const valor = creditDebitColumn?.value ? Number(creditDebitColumn.value) || 0 : 0;
    saldo += valor;

    await updateSaldo(boardId, item.id, saldo);
  }
  
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
