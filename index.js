const fetch = require('node-fetch');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração do Token
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN || "SEU_TOKEN_AQUI";

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

const groupSubitems = (subitems, item) => {
  const grouped = {};

  subitems.forEach(subitem => {
    const name = subitem.name;
    let numbers_mkmxqbg4 = subitem.column_values.find(col => col.id === 'numbers_mkmxqbg4')?.value;

    if (!numbers_mkmxqbg4) {
      console.warn(`Subitem sem o valor 'numbers_mkmxqbg4' encontrado: ${JSON.stringify(subitem)}`);
      return;
    }

    // Remove aspas duplas caso o valor venha como string JSON e converte para número
    numbers_mkmxqbg4 = Number(numbers_mkmxqbg4.replace(/"/g, ''));

    if (isNaN(numbers_mkmxqbg4)) {
      console.warn(`Valor inválido em 'numbers_mkmxqbg4': ${numbers_mkmxqbg4}`);
      return;
    }

    // Usa apenas o nome como chave para o agrupamento
    if (!grouped[name]) {
      grouped[name] = { total: 0, subitems: [], item };
    }

    // Soma os valores do campo numbers_mkmxqbg4
    grouped[name].total += numbers_mkmxqbg4;
    grouped[name].subitems.push(subitem);
  });

  return grouped;
};

const fetchSubitems = async (itemId) => {
  console.log(`Aguardando 3 segundos antes de buscar os subitens do item ${itemId}...`);

  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log(`Buscando subitens do item ${itemId} agora...`);

  const query = `{
    items(ids: ${itemId}) {
      id
      name
      column_values {
        id
        value
      }
      subitems {
        id
        name
        column_values {
          id
          value
        }
      }
    }
  }`;

  const result = await fetchMondayData(query);

  console.log(`Resposta completa da API para o item ${itemId}:`, JSON.stringify(result, null, 2));

  if (!result.data || !result.data.items || !result.data.items[0]) {
    console.error("Resposta da API malformada ou sem item:", JSON.stringify(result, null, 2));
    return {};
  }

  const item = result.data.items[0];
  let subitems = item.subitems || [];

  // Filtra valores nulos, caso existam
  subitems = subitems.filter(Boolean);

  console.log(`Subitens capturados para o item ${itemId}:`, JSON.stringify(subitems, null, 2));

  const groupedSubitems = groupSubitems(subitems, item);

  console.log("Subitens agrupados:", JSON.stringify(groupedSubitems, null, 2));

  return groupedSubitems;
};


// Endpoint para exportar subitens agrupados
app.post('/exportaSubitemsAgrupados', async (req, res) => {
  try {
    console.log("Payload recebido:", JSON.stringify(req.body, null, 2));

    if (req.body.challenge) {
      return res.status(200).json({ challenge: req.body.challenge });
    }

    const { pulseId } = req.body.event;
    if (!pulseId) {
      console.error("ID do item não fornecido no payload.");
      return res.status(400).json({ error: "ID do item não fornecido no payload." });
    }

    const subitems = await fetchSubitems(pulseId);

    if (subitems.length === 0) {
      console.warn(`Nenhum subitem encontrado para o item ${pulseId}.`);
      return res.status(404).json({ message: "Nenhum subitem encontrado para este item." });
    }

    res.json({ success: true, subitems });

  } catch (error) {
    console.error("Erro em exportaSubitemsAgrupados:", error);
    res.status(500).json({ error: "Erro interno ao buscar subitens." });
  }
});


app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
