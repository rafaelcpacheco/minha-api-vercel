const fetch = require('node-fetch');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração do Token
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

const fetchAllItemsWithColumns = async (boardId) => {
  const query = `
    {
      boards(ids: ${boardId}) {
        items_page {
          items {
            id
            // Se existir um campo que indique a posição, inclua-o aqui para ordenar (ex: position)
            // position
            column_values {
              id
              value
            }
          }
        }
      }
    }
  `;
  const result = await fetchMondayData(query);
  if (!result.data || !result.data.boards || !result.data.boards[0]?.items_page?.items) {
    throw new Error("Resposta da API malformada ou vazia");
  }
  let items = result.data.boards[0].items_page.items;
  
  // Se houver um campo de ordenação (ex.: position), descomente e ajuste:
  // items.sort((a, b) => a.position - b.position);
  
  return items;
};

// Função para atualizar múltiplos itens em lote usando a mutação change_multiple_column_values
const updateItemsInBatch = async (boardId, updates) => {
  const mutations = updates.map(({ itemId, saldo }) => {
    // Monta o JSON para atualizar a coluna "Saldo"
    const columnValueStr = `{"n_meros_mkn1khzp": "${saldo}"}`;
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
  console.log("Query de batch:", query);
  await fetchMondayData(query);
};

const updateSaldo = async (boardId, itemId, creditDebitValue) => {
  try {
    const items = await fetchAllItemsWithColumns(boardId);
    const idx = items.findIndex(item => item.id == itemId);
    if (idx === -1) throw new Error("Item não encontrado");

    // Obter o saldo do item anterior, se existir
    let saldoAnterior = 0;
    if (idx > 0) {
      const itemAnterior = items[idx - 1];
      const colSaldo = itemAnterior.column_values.find(col => col.id === "n_meros_mkn1khzp");
      if (colSaldo && colSaldo.value) {
        try {
          saldoAnterior = parseFloat(JSON.parse(colSaldo.value)?.value) || 0;
        } catch (e) {
          saldoAnterior = parseFloat(colSaldo.value) || 0;
        }
      }
    }
    console.log(`Saldo do item anterior (item ${idx-1}): ${saldoAnterior}`);

    const updates = [];
    // Iterar pelos itens a partir do item alterado
    for (let i = idx; i < items.length; i++) {
      const currentItem = items[i];
      const colCreditoDebito = currentItem.column_values.find(col => col.id === "n_meros_mkmcm7c7");
      let valorCredito = 0;
      if (i === idx) {
        // Para o item alterado, usa o novo valor recebido
        valorCredito = parseFloat(creditDebitValue);
      } else if (colCreditoDebito && colCreditoDebito.value) {
        try {
          valorCredito = parseFloat(JSON.parse(colCreditoDebito.value)?.value) || 0;
        } catch (e) {
          valorCredito = parseFloat(colCreditoDebito.value) || 0;
        }
      }
      console.log(`Item ${currentItem.id}: valorCredito=${valorCredito}, saldoAnterior antes da soma=${saldoAnterior}`);
      saldoAnterior += valorCredito;
      console.log(`Novo saldo para item ${currentItem.id}: ${saldoAnterior}`);
      updates.push({ itemId: currentItem.id, saldo: saldoAnterior });
    }
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
    
    if (req.body.challenge) {
      return res.status(200).json({ challenge: req.body.challenge });
    }
    
    const payload = req.body.event;
    if (!payload) {
      return res.status(400).json({ error: "Payload indefinido" });
    }
    
    const { boardId, pulseId, columnId, value } = payload;
    if (!boardId || !pulseId || !columnId || value === undefined) {
      return res.status(400).json({ error: "Dados incompletos" });
    }
    
    // Se a coluna alterada for "Crédito/Débito"
    if (columnId === "n_meros_mkmcm7c7") {
      // value.value contém o novo valor numérico
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
