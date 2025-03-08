const fetch = require('node-fetch');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração do Token
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN || "eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ4Mjc0NjE5NywiYWFpIjoxMSwidWlkIjo3MDc2NDQ5MiwiaWFkIjoiMjAyNS0wMy0wOFQxMzo1MzoyOS42NjBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6Mjc0MjQyMjYsInJnbiI6InVzZTEifQ.wIqpbMeTwKYufgZEDp8oqE1l8XN5OnFs23X9Zw08l5c";

// IDs fixos dos quadros e colunas
const CURRENT_YEAR_BOARD_ID = "8567877886"; // Substitua pelo ID do quadro do ano atual
const PREVIOUS_YEAR_BOARD_ID = "8544189983"; // Substitua pelo ID do quadro do ano anterior
const NF_VALUE_COLUMN_ID = "n_meros_mkndz4p4"; // Substitua pelo ID da coluna que contém o valor da NF
const RECEITA_BRUTA_COLUMN_ID = "n_meros_mkndjypb"; // Substitua pelo ID da coluna "Receita Bruta dos últimos 12 meses"

// Função para chamar a API do monday.com
const fetchMondayData = async (query) => {
  try {
    const response = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        "Authorization": MONDAY_API_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`Erro na requisição: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return result;

  } catch (error) {
    console.error("Erro na requisição:", error);
    throw error;
  }
};

// Função para buscar todos os itens do quadro com paginação
const fetchAllItems = async (boardId) => {
  let allItems = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    const query = `{
      boards(ids: ${boardId}) {
        items_page (limit: 500 ${cursor ? `, cursor: "${cursor}"` : ''}) {
          items {
            id
            column_values {
              id
              value
            }
          }
          cursor
        }
      }
    }`;

    const result = await fetchMondayData(query);

    if (!result.data || !result.data.boards || !result.data.boards[0]?.items_page) {
      console.error("Resposta da API malformada:", JSON.stringify(result, null, 2));
      throw new Error("Resposta da API malformada ou vazia");
    }

    const itemsPage = result.data.boards[0].items_page;

    if (itemsPage.items && itemsPage.items.length > 0) {
      allItems = allItems.concat(itemsPage.items);
    }

    if (itemsPage.cursor) {
      cursor = itemsPage.cursor;
    } else {
      hasMore = false;
    }
  }

  return allItems;
};

// Função para atualizar múltiplas colunas de um item
const updateMultipleColumnValues = async (boardId, itemId, columnValues) => {
  const columnValuesString = JSON.stringify(columnValues).replace(/"/g, '\\"');
  const mutation = `mutation {
    change_multiple_column_values(
      board_id: ${boardId},
      item_id: ${itemId},
      column_values: "${columnValuesString}"
    ) {
      id
    }
  }`;

  await fetchMondayData(mutation);
};

// Função para buscar o somatório das NF's de um quadro específico
const fetchSumOfNFs = async (boardId) => {
  try {
    const items = await fetchAllItems(boardId);

    let totalSum = 0;

    items.forEach(item => {
      const nfValueColumn = item.column_values.find(col => col.id === NF_VALUE_COLUMN_ID);
      const nfValue = parseFloat(JSON.parse(nfValueColumn?.value || "0")) || 0;
      totalSum += nfValue;
    });

    return totalSum;

  } catch (error) {
    console.error("Erro ao buscar somatório das NF's:", error);
    throw error;
  }
};

// Função para atualizar a coluna "Receita Bruta dos últimos 12 meses" no quadro do ano atual
const updateReceitaBruta = async (currentYearBoardId, previousYearSum) => {
  try {
    const columnValues = {
      [RECEITA_BRUTA_COLUMN_ID]: previousYearSum.toString() // Usa o ID fixo da coluna
    };

    // Atualiza o primeiro item do quadro atual (ou escolha um item específico)
    const items = await fetchAllItems(currentYearBoardId);
    const firstItemId = items[0]?.id;

    if (!firstItemId) {
      throw new Error("Nenhum item encontrado no quadro atual!");
    }

    await updateMultipleColumnValues(currentYearBoardId, firstItemId, columnValues);

    return { success: true };

  } catch (error) {
    console.error("Erro ao atualizar Receita Bruta:", error);
    throw error;
  }
};

// Função principal para calcular e atualizar a Receita Bruta
const calculateAndUpdateReceitaBruta = async () => {
  try {
    const previousYearSum = await fetchSumOfNFs(PREVIOUS_YEAR_BOARD_ID);
    await updateReceitaBruta(CURRENT_YEAR_BOARD_ID, previousYearSum);

    return { success: true };

  } catch (error) {
    console.error("Erro em calculateAndUpdateReceitaBruta:", error);
    throw error;
  }
};

// Rota para acionar a atualização da Receita Bruta
app.post('/update-receita-bruta', async (req, res) => {
    try {
      console.log("Payload recebido:", JSON.stringify(req.body, null, 2));
  
      req.setTimeout(120000);
  
      // Verifica se é um desafio do monday.com
      if (req.body.challenge) {
        return res.status(200).json({ challenge: req.body.challenge });
      }
  
      // Processa o payload
      const payload = req.body.event;
  
      if (!payload) {
        console.error("Payload está indefinido.");
        return res.status(400).json({ error: "Payload está indefinido." });
      }
  
      // Executa a lógica de atualização da Receita Bruta
      await calculateAndUpdateReceitaBruta();
      res.json({ success: true });
  
    } catch (error) {
      console.error("Erro na rota /update-receita-bruta:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

// Iniciar o servidor
app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});