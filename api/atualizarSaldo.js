const axios = require('axios');

module.exports = async (req, res) => {
  const { item_id, debito, credito } = req.query; // Passando parâmetros pela URL

  if (!item_id || !debito || !credito) {
    return res.status(400).json({ error: 'Faltando parâmetros' });
  }

  try {
    // Construindo corretamente a string JSON para o campo "Saldo"
    const saldo = parseFloat(debito) + parseFloat(credito);

    const response = await axios.post(
      'https://api.monday.com/v2',
      {
        query: `mutation {
          change_column_values(item_id: ${item_id}, board_id: 8274760820, column_values: ${JSON.stringify({ Saldo: saldo })}) {
            id
          }
        }`
      },
      {
        headers: {
          'Authorization': 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ2Mzk4MjA1OCwiYWFpIjoxMSwidWlkIjo3MDc2NDQ5MiwiaWFkIjoiMjAyNS0wMS0yN1QyMjoyNDozMS42NTFaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6Mjc0MjQyMjYsInJnbiI6InVzZTEifQ.R1qHMX9yxVAGnl4QCxv4bgpS5pvm29vvr5NJuUPZBsw',
          'Content-Type': 'application/json',
        },
      }
    );

    res.status(200).json({ success: true, data: response.data });
  } catch (error) {
    console.error('Erro ao atualizar saldo:', error.response ? error.response.data : error.message);
    res.status(500).json({
      error: 'Erro ao atualizar saldo',
      details: error.response ? error.response.data : error.message,
    });
  }
};
