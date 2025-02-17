const fetch = require('node-fetch');
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;

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

const updateSaldo = async (boardId, itemId, creditDebitValue) => {
  // Sua implementação atual da função updateSaldo
};

module.exports = { fetchMondayData, updateSaldo };