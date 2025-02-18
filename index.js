const fetch = require('node-fetch');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Token de API (certifique-se de configurar a variável de ambiente)
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;

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
      const errorResponse = await response.text();
      throw new Error(`Erro na requisição: ${response.status} ${response.statusText}. Resposta: ${errorResponse}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Erro na requisição:", error);
    throw error;
  }
};

// Função para buscar todos os itens do quadro com suas colunas
const fetchAllItemsWithColumns = async (boardId) => {
  const query = `
    {
      boards(ids: ${boardId}) {
        items {
          id
          column_values {
            id
            value
          }
        }
      }
    }
  `;
  const result = await fetchMondayData(query);
  if (!result.data || !result.data.boards || !result.data.boards[0].items) {
    throw new Error("Resposta da API malformada ou vazia");
  }
  return result.data.boards[0].items;
};

// Função para atualizar vários itens em lote usando a mutação change_multiple_column_values
const updateItemsInBatch = async (boardId, updates) => {
  // Para cada item, montamos uma mutação com alias (cada mutação atualiza apenas a coluna "Saldo")
  const mutations = updates.map(({ itemId, saldo }) => {
    // Constrói a string JSON para column_values conforme a documentação.
    // Exemplo: {"n_meros_mkn1khzp": "1234"}
    const columnValueStr = `{"n_meros_mkn1khzp": "${saldo}"}`;
    // Escapa as aspas internas para ser inserido corretamente na query GraphQL.
    const escapedValue = columnValueStr.replace(/"/g, '\\"');
    return `
      upd_${itemId}: change_multiple_column_values(
        board_id: ${boardId},
        item_id: ${itemId},
        column_values: "${escapedValue}"
      ) { id }
    `;
  }).join("\n");
  
  const query = `mutation { ${mutations} }`;
  console.log("Query para batch:", query);
  await fetchMondayData(query);
};

// Função para recalcular e atualizar o saldo cumulativo
const updateSaldo = async (boardId, itemId, creditDebitValue) => {
  try {
    // 1. Buscar todos os itens do quadro
    const items = await fetchAllItemsWithColumns(boardId);
    
    // Encontrar o índice do item alterado (pulseId recebido)
    const idx = items.findIndex(item => item.id == itemId);
    if (idx === -1) throw new Error("Item não encontrado");

    // 2. Obter o saldo do item anterior (se existir)
    let saldoAnterior = 0;
    if (idx > 0) {
      const itemAnterior = items[idx - 1];
      const colSaldo = itemAnterior.column_values.find(col => col.id === "n_meros_mkn1khzp");
      if (colSaldo && colSaldo.value) {
        try {
          // Se o valor estiver no formato JSON, extraímos a propriedade "value"
          saldoAnterior = parseFloat(JSON.parse(colSaldo.value)?.value) || 0;
        } catch (e) {
          saldoAnterior = parseFloat(colSaldo.value) || 0;
        }
      }
    }
    
    // 3. Iterar pelos itens a partir do item alterado e recalcular o saldo cumulativo
    const updates = [];
    for (let i = idx; i < items.length; i++) {
      const currentItem = items[i];
      const colCreditoDebito = currentItem.column_values.find(col => col.id === "n_meros_mkmcm7c7");
      let valorCredito = 0;
      if (i === idx) {
        // Para o item alterado, usar o novo valor recebido no webhook
        valorCredito = parseFloat(creditDebitValue);
      } else {
        // Para os demais, extrair o valor já presente na coluna "Crédito/Débito"
        if (colCreditoDebito && colCreditoDebito.value) {
          try {
            valorCredito = parseFloat(JSON.parse(colCreditoDebito.value)?.value) || 0;
          } catch (e) {
            valorCredito = parseFloat(colCreditoDebito.value) || 0;
          }
        }
      }
      saldoAnterior += valorCredito;
      updates.push({ itemId: currentItem.id, saldo: saldoAnterior });
    }
    
    // 4. Atualizar os itens com os novos saldos
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
    
    // Se houver um challenge (para verificação de webhook), retorne-o
    if (req.body.challenge) {
      return res.status(200).json({ challenge: req.body.challenge });
    }
    
    const payload = req.body.event;
    if (!payload) {
      return res.status(400).json({ error: "Payload indefinido" });
    }
    
    // Extraindo os dados necessários do payload
    const { boardId, pulseId, columnId, value } = payload;
    if (!boardId || !pulseId || !columnId || value === undefined) {
      return res.status(400).json({ error: "Dados incompletos" });
    }
    
    // Se a coluna alterada for "Crédito/Débito" (ID: n_meros_mkmcm7c7), recalcula o saldo
    if (columnId === "n_meros_mkmcm7c7") {
      // value.value contém o novo valor (ex: -3000)
      await updateSaldo(boardId, pulseId, value.value);
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
