const fetch = require('node-fetch');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração do Token
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN || "SEU_TOKEN_AQUI";

// Função para chamar a API do monday.com
const fetchMondayData = async (query, variables = {}) => {
  try {
    const response = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        "Authorization": MONDAY_API_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Erro na requisição:", data.errors || data);
      throw new Error(`Erro na requisição: ${response.status} ${response.statusText}`);
    }

    return data;
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

// Função para calcular e atualizar os saldos
const updateSaldos = async (boardId, startItemId, creditDebitValue) => {
  try {
    const items = await fetchAllItems(boardId);

    const startIndex = items.findIndex(item => item.id == startItemId);
    if (startIndex === -1) {
      throw new Error(`Item com ID ${startItemId} não encontrado no quadro!`);
    }

    let saldoAnterior = 0;
    if (startIndex > 0) {
      const previousItem = items[startIndex - 1];
      const previousSaldoColumn = previousItem.column_values.find(col => col.id === "n_meros_mkn1khzp");
      saldoAnterior = parseFloat(JSON.parse(previousSaldoColumn?.value || "0")) || 0;
    }

    for (let i = startIndex; i < items.length; i++) {
      const currentItem = items[i];
      const creditDebitColumn = currentItem.column_values.find(col => col.id === "n_meros_mkmcm7c7");
      const currentCreditDebitValue = i === startIndex ? creditDebitValue : parseFloat(JSON.parse(creditDebitColumn?.value || "0")) || 0;

      saldoAnterior += currentCreditDebitValue;

      const columnValues = {
        n_meros_mkn1khzp: saldoAnterior.toString()
      };

      await updateMultipleColumnValues(boardId, currentItem.id, columnValues);
    }

    return { success: true };

  } catch (error) {
    console.error("Erro em updateSaldos:", error);
    throw error;
  }
};

const replaceVariablesInQuery = (query, variables) => {
  let formattedQuery = query;

  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\$${key}`, "g");
    formattedQuery = formattedQuery.replace(regex, JSON.stringify(value));
  }

  return formattedQuery;
};

const moveSubitemsToAnotherBoard = async (sourceBoardId, sourceItemId, targetBoardId, targetGroupId) => {
  try {

    // Query para buscar subitens
    const query = `
      query {
        boards(ids: [$boardId]) {
          items_page(limit: 10) {
            items {
              name
              subitems {
                id
                name
                column_values {
                  id
                  text
                  value
                }
              }
            }
          }
        }
      }
    `;

    const variables = {
      boardId: sourceBoardId,
    };

    // Substitui as variáveis na query
    const formattedQuery = replaceVariablesInQuery(query, variables);

    console.log("Query para buscar subitens:", formattedQuery);

    const result = await fetchMondayData(query, variables);

    console.log("Resposta da API ao buscar subitens:", JSON.stringify(result, null, 2));

    if (!result.data || !result.data.boards || !result.data.boards[0]?.items_page?.items) {
      console.error("Resposta da API malformada ou sem subitens.");
      throw new Error("Resposta da API malformada ou vazia");
    }

    const subitems = result.data.boards[0].items_page.items[0].subitems;

    console.log("Subitens encontrados:", JSON.stringify(subitems, null, 2));

    // Move cada subitem para o quadro de destino
    for (const subitem of subitems) {
      const mutation = `mutation {
        move_item_to_group (item_id: ${subitem.id}, group_id: "${targetGroupId}") {
          id
        }
      }`;

      console.log("Mutation para mover subitem:", mutation);

      const mutationResult = await fetchMondayData(mutation);

      console.log("Resposta da API ao mover subitem:", JSON.stringify(mutationResult, null, 2));
    }

    console.log("Subitens movidos com sucesso.");
    return { success: true };

  } catch (error) {
    console.error("Erro ao mover subitens:", error);
    throw error;
  }
};

// Endpoint original (webhook)
app.post('/webhook', async (req, res) => {
  try {
    console.log("Payload recebido:", JSON.stringify(req.body, null, 2));

    req.setTimeout(120000);

    if (req.body.challenge) {
      return res.status(200).json({ challenge: req.body.challenge });
    }

    const payload = req.body.event;

    if (!payload) {
      console.error("Payload está indefinido.");
      return res.status(400).json({ error: "Payload está indefinido." });
    }

    const { boardId, pulseId, columnId, value } = payload;

    if (!boardId || !pulseId || !columnId || !value) {
      return res.status(400).json({ error: "Dados incompletos!" });
    }

    const creditDebitValue = parseFloat(value.value) || 0;

    if (columnId === "n_meros_mkmcm7c7") {
      await updateSaldos(boardId, pulseId, creditDebitValue);
      return res.json({ success: true });
    }

    res.json({ message: "Coluna não monitorada." });

  } catch (error) {
    console.error("Erro no webhook:", error);
    res.status(500).json({ error: "Erro interno" });
  }
});

// Endpoint para mover subitens
app.post('/moveSubItensReembolsoDespesas', async (req, res) => {
  try {
    console.log("Payload recebido:", JSON.stringify(req.body, null, 2));

    req.setTimeout(120000);

    if (req.body.challenge) {
      console.log("Challenge recebido:", req.body.challenge);
      return res.status(200).json({ challenge: req.body.challenge });
    }

    const payload = req.body.event;

    if (!payload) {
      console.error("Payload está indefinido.");
      return res.status(400).json({ error: "Payload está indefinido." });
    }

    const { boardId, pulseId, columnId, value } = payload;

    if (!boardId || !pulseId || !columnId || !value) {
      console.error("Dados incompletos no payload:", { boardId, pulseId, columnId, value });
      return res.status(400).json({ error: "Dados incompletos!" });
    }

    console.log("Dados do payload:", { boardId, pulseId, columnId, value });

    // Verifica se o status mudou para "Aprovado"
    if (columnId === "status_mkmy5rzh" && value.label.index === 1) { // Corrigido aqui
      const targetBoardId = 8738136631; // ID do quadro de destino
      const targetGroupId = "new_group_mkmy776h"; // ID do grupo "Em Aprovação" no quadro de destino

      console.log("Status mudou para 'Aprovado'. Iniciando movimentação de subitens...");

      await moveSubitemsToAnotherBoard(boardId, pulseId, targetBoardId, targetGroupId);
      return res.json({ success: true });
    }

    console.log("Coluna não monitorada ou status não alterado para 'Aprovado'.");
    res.json({ message: "Coluna não monitorada ou status não alterado para Aprovado." });

  } catch (error) {
    console.error("Erro no endpoint moveSubItensReembolsoDespesas:", error);
    res.status(500).json({ error: "Erro interno" });
  }
});

// Inicia o servidor
app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});