const express = require('express');
const fetch = require('node-fetch');
const { fetchMondayData, updateSaldo } = require('./mondayUtils');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Webhook
app.post('/webhook', async (req, res) => {
  try {
    console.log("Payload recebido:", JSON.stringify(req.body, null, 2));

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

    const creditDebitValue = value.value;

    if (columnId === "n_meros_mkmcm7c7") {
      // Inicia o processamento em lotes
      await fetch(`${process.env.VERCEL_URL}/api/processBatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId, pulseId, creditDebitValue, cursor: null }),
      });

      return res.json({ success: true });
    }

    res.json({ message: "Coluna não monitorada." });

  } catch (error) {
    console.error("Erro no webhook:", error);
    res.status(500).json({ error: "Erro interno" });
  }
});

// Função para processar um lote de itens
app.post('/api/processBatch', async (req, res) => {
  try {
    const { boardId, pulseId, creditDebitValue, cursor } = req.body;

    // Passo 1: Buscar um lote de itens
    const query = `{
      boards(ids: ${boardId}) {
        items_page (limit: 10 ${cursor ? `, cursor: "${cursor}"` : ''}) {
          items {
            id
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
    const items = itemsPage.items;

    // Passo 2: Processar os itens do lote
    for (const item of items) {
      await updateSaldo(boardId, item.id, creditDebitValue);
    }

    // Passo 3: Verificar se há mais itens para processar
    if (itemsPage.cursor) {
      // Chama a função recursivamente para processar o próximo lote
      await fetch(`${process.env.VERCEL_URL}/api/processBatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId, pulseId, creditDebitValue, cursor: itemsPage.cursor }),
      });
    }

    res.json({ success: true });

  } catch (error) {
    console.error("Erro em processBatch:", error);
    res.status(500).json({ error: "Erro interno" });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});