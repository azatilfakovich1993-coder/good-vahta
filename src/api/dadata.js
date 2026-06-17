/**
 * DaData "Подсказки" — company lookup by INN (ЕГРЮЛ/ЕГРИП).
 * Public suggestions API-KEY is safe to call directly from the browser
 * (this is DaData's own recommended usage for this endpoint).
 */
const DADATA_API_KEY = 'beff2c188fa5da5544b496e9044aeec6cfddb97f8';
const URL = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party';

export async function lookupCompanyByInn(inn) {
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Token ${DADATA_API_KEY}`,
      },
      body: JSON.stringify({ query: inn }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.suggestions?.[0] || null;
  } catch {
    return null;
  }
}
