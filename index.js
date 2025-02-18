const fetch = require('node-fetch');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração do Token
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN || "eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ2Mzk4MjA1OCwiYWFpIjoxESwidWlkIjo3MDc2NDQ5MiwiaWFkIjoiMjAyNS0wMS0yN1QyMjoyNDozMS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6Mjc0MjQyMjYsInJnbiI6InVzZTEifQ.ZmiPuR6zE_1jWletXG_8zLUhKizffHyRROHvX0h97o0";

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
      const errorResponse = await response.text(); // Captura a resposta de erro
      throw new Error(`Erro na requisição: ${response.status} ${response.statusText}. Resposta: ${errorResponse}`);
    }

    const result = await response.json();
    return result;

  } catch (error) {
    console.error("Erro na requisição:", error);
    throw error;
  }
};

// Função para buscar todos os itens do quadro com suas colunas
const fetchAllItemsWithColumns = async (boardId) => {
  const query = `{
    boards(ids: ${boardId}) {
      items_page {
        items {
          id
          column_values {
            id
            value
          }
        }
      }
    }
  }`;

  const result = await fetchMondayData(query);

  if (!result.data || !result.data.boards || !result.data.boards[0]?.items_page?.items) {
    console.error("Resposta da API malformada:", JSON.stringify(result, null, 2));
    throw new Error("Resposta da API malformada ou vazia");
  }

  return result.data.boards[0].items_page.items;
};

// Função para atualizar múltiplos itens em lote
const updateItemsInBatch = async (boardId, updates) => {
  const mutations = updates.map(({ itemId, saldo }) => `
    change_column_value_${itemId}: change_column_value(
      board_id: ${boardId},
      item_id: ${itemId},
      column_id: "n_meros_mkn1khzp", 
      value: "${saldo}"
    ) { id }
  `).join('\n');

  const query = `mutation { ${mutations} }`;

  await fetchMondayData(query);
};

// Função principal para atualizar o saldo
const updateSaldo = async (boardId, itemId, creditDebitValue) => {
  try {
    // Passo 1: Buscar todos os itens do quadro com suas colunas
    const items = await fetchAllItemsWithColumns(boardId);

    // Passo 2: Encontrar o índice do item alterado
    const itemIndex = items.findIndex(item => item.id == itemId);

    if (itemIndex === -1) {
      throw new Error(`Item com ID ${itemId} não encontrado no quadro!`);
    }

    // Passo 3: Calcular os novos saldos em memória
    let saldoAnterior = 0;

    // Buscar o saldo da linha anterior (se existir)
    if (itemIndex > 0) {
      const previousItem = items[itemIndex - 1];
      const previousSaldoColumn = previousItem.column_values.find(col => col.id === "n_meros_mkn1khzp");

      if (!previousSaldoColumn) {
        throw new Error("Coluna 'Saldo' não encontrada na linha anterior!");
      }

      // Converter o valor do saldo anterior para número
      saldoAnterior = parseFloat(JSON.parse(previousSaldoColumn.value)?.value || 0);
    }

    const updates = [];

    // Iterar sobre os itens a partir do item alterado
    for (let i = itemIndex; i < items.length; i++) {
      const currentItem = items[i];

      // Encontrar a coluna "Crédito/Débito"
      const creditDebitColumn = currentItem.column_values.find(col => col.id === "n_meros_mkmcm7c7");

      if (!creditDebitColumn) {
        throw new Error("Coluna 'Crédito/Débito' não encontrada!");
      }

      // Converter o valor de "Crédito/Débito" para número
      const creditDebitValueCurrent = parseFloat(JSON.parse(creditDebitColumn.value)?.value || 0);

      // Calcular o novo saldo
      if (i === itemIndex) {
        // Para o item alterado, somar o novo valor de "Crédito/Débito" ao saldo anterior
        saldoAnterior += creditDebitValue;
      } else {
        // Para os demais itens, somar o valor existente de "Crédito/Débito" ao saldo anterior
        saldoAnterior += creditDebitValueCurrent;
      }

      // Armazenar a atualização
      updates.push({ itemId: currentItem.id, saldo: saldoAnterior });
    }


    // Passo 4: Atualizar todos os itens em lote
    await updateItemsInBatch(boardId, updates);

    return { success: true };

  } catch (error) {
    console.error("Erro em updateSaldo:", error);
    throw error;
  }
};

// Rota do webhook
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

    // Extrair o valor numérico do objeto value
    const creditDebitValue = value.value;

    if (columnId === "n_meros_mkmcm7c7") {
      await updateSaldo(boardId, pulseId, creditDebitValue);
      return res.json({ success: true });
    }

    res.json({ message: "Coluna não monitorada." });

  } catch (error) {
    console.error("Erro no webhook:", error);
    res.status(500).json({ error: "Erro interno" });
  }
});

// Iniciar o servidor
app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});