const fetch = require('node-fetch');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração do Token
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN || "eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ2Mzk4MjA1OCwiYWFpIjoxMSwidWlkIjo3MDc2NDQ5MiwiaWFkIjoiMjAyNS0wMS0yN1QyMjoyNDozMS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6Mjc0MjQyMjYsInJnbiI6InVzZTEifQ.ZmiPuR6zE_1jWletXG_8zLUhKizffHyRROHvX0h97o0";

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

// Função para buscar todos os itens do quadro (com paginação)
const fetchAllItems = async (boardId) => {
  let allItems = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    const query = `{
      boards(ids: ${boardId}) {
        items_page (limit: 100 ${cursor ? `, cursor: "${cursor}"` : ''}) {
          items {
            id
          }
          cursor
        }
      }
    }`;

    const result = await fetchMondayData(query);

    // Verificar se a resposta está no formato esperado
    if (!result.data || !result.data.boards || !result.data.boards[0]?.items_page) {
      console.error("Resposta da API malformada:", JSON.stringify(result, null, 2));
      throw new Error("Resposta da API malformada ou vazia");
    }

    const itemsPage = result.data.boards[0].items_page;

    // Adicionar itens à lista
    if (itemsPage.items && itemsPage.items.length > 0) {
      allItems = allItems.concat(itemsPage.items);
    }

    // Verificar se há mais itens
    if (itemsPage.cursor) {
      cursor = itemsPage.cursor;
    } else {
      hasMore = false;
    }
  }

  return allItems;
};

const updateSaldo = async (boardId, itemId, creditDebitValue) => {
  try {
    // Passo 1: Atualizar o valor do Crédito/Débito da linha passada como parâmetro
    const updateCreditDebitQuery = `mutation {
      change_column_value(
        board_id: ${boardId},
        item_id: ${itemId},
        column_id: "n_meros_mkmcm7c7", 
        value: "${creditDebitValue}"
      ) { id }
    }`;

    await fetchMondayData(updateCreditDebitQuery);

    // Passo 2: Buscar todos os IDs dos itens do quadro (com paginação)
    const items = await fetchAllItems(boardId);

    // Encontrar o índice do item alterado
    const itemIndex = items.findIndex(item => item.id == itemId); // Use == para comparar IDs como strings ou números

    if (itemIndex === -1) {
      throw new Error(`Item com ID ${itemId} não encontrado no quadro!`);
    }

    // Passo 3: Buscar o saldo da linha anterior (se existir)
    let saldoAnterior = 0;

    if (itemIndex > 0) {
      const previousItemId = items[itemIndex - 1].id;

      // Buscar os dados da linha anterior
      const getPreviousItemQuery = `{
        items(ids: ${previousItemId}) {
          column_values {
            id
            value
          }
        }
      }`;

      const previousItemData = await fetchMondayData(getPreviousItemQuery);

      // Verificar se a resposta está no formato esperado
      if (!previousItemData.data || !previousItemData.data.items || !previousItemData.data.items[0]?.column_values) {
        console.error("Resposta da API malformada:", JSON.stringify(previousItemData, null, 2));
        throw new Error("Resposta da API malformada ou vazia");
      }

      const previousColumnValues = previousItemData.data.items[0].column_values;

      // Encontrar a coluna "Saldo" da linha anterior
      const previousSaldoColumn = previousColumnValues.find(col => col.id === "n_meros_mkn1khzp"); // Substitua pelo ID real

      if (!previousSaldoColumn) {
        throw new Error("Coluna 'Saldo' não encontrada na linha anterior!");
      }

      // Converter o valor do saldo anterior para número
      saldoAnterior = parseFloat(JSON.parse(previousSaldoColumn.value)) || 0;
    }

    // Passo 4: Iterar sobre cada ID a partir do item alterado e buscar os dados da linha
    for (let i = itemIndex; i < items.length; i++) {
      const currentItemId = items[i].id;

      // Buscar os dados da linha específica
      const getItemQuery = `{
        items(ids: ${currentItemId}) {
          column_values {
            id
            value
          }
        }
      }`;

      const itemData = await fetchMondayData(getItemQuery);

      // Verificar se a resposta está no formato esperado
      if (!itemData.data || !itemData.data.items || !itemData.data.items[0]?.column_values) {
        console.error("Resposta da API malformada:", JSON.stringify(itemData, null, 2));
        throw new Error("Resposta da API malformada ou vazia");
      }

      const columnValues = itemData.data.items[0].column_values;

      // Encontrar a coluna "Crédito/Débito" e "Saldo"
      const creditDebitColumn = columnValues.find(col => col.id === "n_meros_mkmcm7c7"); // Substitua pelo ID real
      const saldoColumn = columnValues.find(col => col.id === "n_meros_mkn1khzp"); // Substitua pelo ID real

      if (!creditDebitColumn || !saldoColumn) {
        throw new Error("Coluna 'Crédito/Débito' ou 'Saldo' não encontrada!");
      }

      // Converter o valor de "Crédito/Débito" para número
      const creditDebitValue = parseFloat(JSON.parse(creditDebitColumn.value)) || 0;

      // Verificar se o saldo anterior é 0 ou null
      if (saldoAnterior === 0 || saldoAnterior === null) {
        // Se o saldo anterior for 0 ou null, replicar o valor do crédito/débito
        saldoAnterior = creditDebitValue;
      } else {
        // Caso contrário, calcular o novo saldo
        saldoAnterior += creditDebitValue;
      }

      // Atualizar a coluna "Saldo" do item atual
      const updateQuery = `mutation {
        change_column_value(
          board_id: ${boardId},
          item_id: ${currentItemId},
          column_id: "n_meros_mkn1khzp", 
          value: "${saldoAnterior}"
        ) { id }
      }`;

      await fetchMondayData(updateQuery);
    }

    return { success: true };

  } catch (error) {
    console.error("Erro em updateSaldo:", error);
    throw error;
  }
};

app.post('/webhook', async (req, res) => {
  try {
    console.log("Payload recebido:", JSON.stringify(req.body, null, 2)); 

    req.setTimeout(120000);

    if (req.body.challenge) {
      // Responde com o mesmo payload recebido
      return res.status(200).json({ challenge: req.body.challenge });
    }

    const payload = req.body.event;

    if (!payload) {
      console.error("Payload está indefinido.");
      return res.status(400).json({ error: "Payload está indefinido." });
    }

    const { boardId, pulseId, columnId, value } = payload;

    // Validação básica
    if (!boardId || !pulseId || !columnId || !value) {
      return res.status(400).json({ error: "Dados incompletos!" });
    }

    // Extrair o valor numérico do objeto value
    const creditDebitValue = value.value;

    if (columnId === "n_meros_mkmcm7c7") { // Substitua pelo ID real da coluna "Crédito/Débito"
      await updateSaldo(boardId, pulseId, creditDebitValue);
      return res.json({ success: true });
    }

    res.json({ message: "Coluna não monitorada." });

  } catch (error) {
    console.error("Erro no webhook:", error);
    res.status(500).json({ error: "Erro interno" });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});